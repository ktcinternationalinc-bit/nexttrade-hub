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
import { daysBetween, phaseOf, slotOf, balanceOf, langOf, missingFields, statusOf, polOfRelease, releaseList, recipientsOf, autoCheck, SIGNATURE, DEFAULT_CC, REQUIRED_FROM, MAX_INVOICE_PDFS } from './arrival-reminders';
import { buildInvoicePdf } from './invoice-pdf';

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
    var fields = { name: String((cust && (cust.contact_name || cust.company_name)) || o.customer_name || '').trim(),
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
    // v55.83-XY (Max 23 Nov: "change that .. take from hub customer") — Send-to = the e-mail(s) on the HUB invoice customer. Nothing is
    // taken from the warehouse feed for the address or the language.
    var hb = recipientsOf(cust ? cust.email : ''); var hubEmail = hb.list.join(', ') || null;
    if (hb.extra) { warnings.push('The Hub customer has more than 5 e-mail addresses — only the first 5 are used.'); }
    var slot = slotOf(days, today); var mine = logBy[String(o.id)] || [];
    function inSlot(l) { return l.slot === slot && l.channel === 'email' && l.mode !== 'test'; }
    var slotSent = mine.some(function (l) { return inSlot(l) && l.status === 'sent'; });
    // delivery unconfirmed (Codex 22 Nov P2): the mail server did not answer, or the send never finished. It may have reached the customer.
    var slotUnconfirmed = mine.some(function (l) { return inSlot(l) && (l.status === 'unknown' || l.status === 'sending'); });
    var slotFailedAuto = mine.filter(function (l) { return l.slot === slot && l.channel === 'email' && l.mode === 'auto' && l.status === 'failed'; }).length;
    var rem = statusOf(mine);
    if (limited) { blocks = [LIMITED_WORDS]; warnings = []; fields = Object.assign({}, fields, { total: null, received: null, remaining: null, releases: [] }); if (rem.last) { rem.last = Object.assign({}, rem.last, { total: null, received: null, remaining: null }); } }
    rows.push({ order_id: Number(o.id), release_number: o.release_number || null, release_key: rk, customer: o.customer_name || null, hub_customer: cust ? (cust.company_name || cust.contact_name || null) : null,
      warehouse: o.warehouse_name || null, country: o.country || null, container: o.container || null, status: o.status, arrival_date: arrival, days: days, phase: phase, slot: slot, slot_sent: slotSent, slot_unconfirmed: slotUnconfirmed, slot_failed_auto: slotFailedAuto, limited: limited,
      language: langOf(cust && cust.correspondence_language), language_chosen: !!(cust && cust.correspondence_language), email: hubEmail, email_from: hubEmail ? 'hub' : null, recipients: hb.list, recipients_bad: hb.bad, whatsapp: o.customer_whatsapp || null,
      invoices: limited ? [] : invs.map(function (i) { return { id: i.id, number: i.number, total: i.total, paid: i.paid }; }), invoice_count: invs.length, balance: bal.ok ? { total: bal.total, received: bal.received, remaining: bal.remaining, overpaid: bal.overpaid } : null,
      pol: polR.certain ? polR.pol : null, pol_needs_confirm: !polR.certain, pol_suggestion: polR.certain ? null : (o.warehouse_name || null), release_prefix: polR.prefix,
      fields: fields, blocks: blocks, warnings: warnings, reminders: rem });
  });
  rows.forEach(function (r) { r.auto = r.limited ? null : autoCheck(r); }); // what the morning schedule would do with this order (not told to a person limited by the history window)
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
    from: '"' + SIGNATURE + '" <' + user + '>',
    // v55.83-XY (Max 23 Nov: "SHOULS BE SENT FROM info@ktcus.com") — a mailbox set to any other address never sends a reminder
    from_ok: user === REQUIRED_FROM, wrong_from: isEmail(user) && pass.length > 0 && user !== REQUIRED_FROM };
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
  if (cfg.user !== REQUIRED_FROM) { return { ok: false, wrong_from: true, error: 'The mailbox connected on the server is ' + cfg.user + ', not ' + REQUIRED_FROM + ' — reminders are only sent from ' + REQUIRED_FROM + '.' }; }
  var rcp = recipientsOf(m.to); if (!rcp.list.length || rcp.bad.length) { return { ok: false, error: 'The recipient address is not valid.' }; }
  var dom = cfg.user.substring(cfg.user.indexOf('@') + 1);
  var mid = '<arrival-' + String(m.id || Date.now().toString(36)).replace(/[^a-z0-9]/gi, '').toLowerCase().substring(0, 40) + '@' + dom + '>';
  var mail = { from: cfg.from, to: rcp.list.join(', '), subject: m.subject, text: m.text, html: m.html, messageId: mid, replyTo: cfg.user, headers: { 'X-KTC-Reference': 'arrival-reminder' } };
  var ccl = recipientsOf((m.cc || []).join(', ')).list.filter(function (x) { return rcp.list.map(function (y) { return y.toLowerCase(); }).indexOf(x.toLowerCase()) < 0; });
  if (ccl.length) { mail.cc = ccl.join(', '); }
  if (m.attachments && m.attachments.length) { mail.attachments = m.attachments.map(function (x) { return { filename: x.filename, content: x.content, contentType: 'application/pdf' }; }); }
  var info = null; var err = null;
  try { info = await makeTransport(cfg, o).sendMail(mail); } catch (e) { err = e; }
  if (err) {
    var unsure = uncertainFailure(err);
    // a timeout can come AFTER the mail server accepted the message. The Sent folder does not settle it: the copy is only saved after a confirmed send.
    return { ok: false, outcome_unknown: unsure, error: (unsure ? 'DELIVERY UNCONFIRMED — the mail server did not answer in time, so the message may or may not have reached the customer. ' : '') + String((err && err.message) || err).substring(0, 300) };
  }
  var resp = String((info && info.response) || '').substring(0, 200);
  if (!info || !info.accepted || info.accepted.length === 0) { return { ok: false, error: 'The mail server did not accept the recipient: ' + (resp || 'no answer') }; }
  var refused = (info.rejected || []).map(function (x) { return String(x); });
  var copied = await copyToSent(cfg, mail, o);
  return { ok: true, message_id: mid, smtp_response: resp, copied_to_sent: copied, from: cfg.user, accepted: (info.accepted || []).map(function (x) { return String(x); }), rejected: refused };
}

// ── v55.83-XY: the automatic schedule's switch and its last run, kept in app_settings (the same table as the history window) ──
export var AUTO_SWITCH_KEY = 'arrival_reminders_auto'; export var AUTO_LAST_RUN_KEY = 'arrival_reminders_auto_last_run';
// → { value } (null when never set) or { error }. An unreadable switch is NEVER taken as "on".
export async function readSetting(db, key) {
  var res = await db.from('app_settings').select('*').or('key.eq.' + key + ',setting_key.eq.' + key).limit(1);
  if (res && res.error) { res = await db.from('app_settings').select('*').eq('key', key).limit(1); }
  if (res && res.error) { return { error: res.error.message }; }
  var row = (res && res.data && res.data.length) ? res.data[0] : null;
  if (!row) { return { value: null }; }
  if (row.value && typeof row.value === 'object') { return { value: row.value }; }
  if (row.setting_value) { try { return { value: JSON.parse(row.setting_value) }; } catch (eP) { return { error: 'the setting is not readable' }; } }
  return { value: null };
}
export async function writeSetting(db, key, value, by) {
  var full = { key: key, value: value, setting_key: key, setting_value: JSON.stringify(value), updated_by: by || null, updated_at: new Date().toISOString() };
  var up = await db.from('app_settings').upsert(full, { onConflict: 'key' }).select();
  if (up && up.error && /setting_key|setting_value|column/.test(up.error.message || '')) { up = await db.from('app_settings').upsert({ key: key, value: value, updated_by: by || null, updated_at: new Date().toISOString() }, { onConflict: 'key' }).select(); }
  return up && up.error ? { error: up.error.message } : { ok: true };
}
// the switch is ON only when the stored value says exactly enabled === true
export function autoIsOn(setting) { return !!(setting && setting.value && setting.value.enabled === true); }

// ── v55.83-XY: who is copied on every customer reminder (Max 23 Nov: "cced to Jasmine@ktcus.com hsaad@ktcus.com") ──
// A setting (app_settings arrival_reminders_cc = { list: [...] }) whose starting value is those two. An unreadable or malformed
// setting falls back to the starting value: the copy to the office is never silently lost.
export var CC_KEY = 'arrival_reminders_cc';
export async function ccFor(db) {
  var st = null; try { st = await readSetting(db, CC_KEY); } catch (e) { st = null; }
  if (st && !st.error && st.value && Array.isArray(st.value.list)) { var r = recipientsOf(st.value.list.join(', ')); if (!r.bad.length) { return r.list; } }
  return DEFAULT_CC.slice();
}

// ── v55.83-XY: a copy of the customer invoice(s) as PDF (Max 23 Nov: "please attach a copy of the invoice") ──
// Only the customer invoice: its own row, its lines, its customer and the company profile. Never the customs invoice, never a cost.
// It NEVER throws and never stops a reminder (Max: "SEND IT ANYWAY"): what could not be attached is returned as a note, which goes
// on the log row and on the list so someone can send the invoice afterwards.
export async function buildInvoiceAttachments(db, invoiceIds) {
  var ids = (invoiceIds || []).filter(Boolean); var out = { attachments: [], names: [], note: null }; var notes = [];
  if (!ids.length) { out.note = 'No invoice to attach.'; return out; }
  try {
    var use = ids.slice(0, MAX_INVOICE_PDFS); if (ids.length > use.length) { notes.push((ids.length - use.length) + ' more invoice(s) were not attached (at most ' + MAX_INVOICE_PDFS + ' per reminder)'); }
    var iv = await db.from('accounting_invoices').select('*').in('id', use); if (iv.error) { throw new Error(iv.error.message); }
    var it = await db.from('accounting_invoice_items').select('*').in('invoice_id', use); if (it.error) { throw new Error(it.error.message); }
    var py = await db.from('accounting_invoice_payments').select('id, accounting_invoice_id, amount, voided, sync_status').in('accounting_invoice_id', use); if (py.error) { throw new Error(py.error.message); }
    var cp = await db.from('company_profile').select('*').limit(1); var company = (cp && !cp.error && cp.data && cp.data[0]) || {};
    var cids = {}; (iv.data || []).forEach(function (x) { if (x.accounting_customer_id) { cids[x.accounting_customer_id] = true; } });
    var cu = Object.keys(cids).length ? await db.from('accounting_customers').select('id, company_name, contact_name, billing_address, email, phone').in('id', Object.keys(cids)) : { data: [] };
    var custBy = {}; ((cu && cu.data) || []).forEach(function (c) { custBy[c.id] = c; });
    var total = 0;
    use.forEach(function (id) {
      var inv = (iv.data || []).filter(function (x) { return String(x.id) === String(id); })[0];
      if (!inv) { notes.push('an invoice could not be read'); return; }
      if (!isArEligible(inv)) { notes.push((inv.invoice_number || 'an invoice') + ': not attached (void or draft)'); return; }
      var paid = (Number(inv.wave_imported_paid) || 0) + (py.data || []).filter(function (p) { return String(p.accounting_invoice_id) === String(id) && !isPaymentVoid(p); }).reduce(function (a, p) { return a + (Number(p.amount) || 0); }, 0);
      var r = null; try { r = buildInvoicePdf({ invoice: inv, items: (it.data || []).filter(function (x) { return String(x.invoice_id) === String(id); }), customer: custBy[inv.accounting_customer_id] || {}, company: company, paid: paid }); } catch (eB) { r = { ok: false, reason: 'the PDF could not be written (' + String((eB && eB.message) || eB).substring(0, 80) + ')' }; }
      if (!r.ok) { notes.push((inv.invoice_number || 'an invoice') + ': ' + r.reason); return; }
      if (total + r.bytes.length > 8000000) { notes.push((inv.invoice_number || 'an invoice') + ': too large to attach'); return; }
      total += r.bytes.length; out.attachments.push({ filename: r.filename, content: r.bytes }); out.names.push(r.filename);
    });
  } catch (e) { out.attachments = []; out.names = []; notes = ['the invoice could not be read (' + String((e && e.message) || e).substring(0, 120) + ')']; }
  out.note = notes.length ? 'Sent WITHOUT ' + (out.attachments.length ? 'every invoice' : 'the invoice') + ' attached — ' + notes.join('; ') + '.' : null;
  return out;
}

// ── v55.83-XY: the log row. The three new columns (cc, invoices_attached, attachment_note) come with sql/v55-83-XY; until that is
// installed the row is written without them rather than refusing the send (the reminder log itself must already be there). ──
export async function insertLog(db, extra, base) {
  var ins = await db.from('arrival_reminders').insert(Object.assign({}, base, extra || {})).select('id').maybeSingle();
  if (ins && ins.error && /cc|invoices_attached|attachment_note/.test(String(ins.error.message || '')) && /column|schema cache/i.test(String(ins.error.message || ''))) {
    ins = await db.from('arrival_reminders').insert(Object.assign({}, base)).select('id').maybeSingle(); if (ins && !ins.error) { ins.without_new_columns = true; }
  }
  return ins;
}
