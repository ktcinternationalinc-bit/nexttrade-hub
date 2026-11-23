// /api/accounting/arrival-reminders — v55.83-XG (Max, 22 Nov 2026). ARRIVAL + FINAL-PAYMENT REMINDERS, Phase 1: e-mail, by hand.
// For each warehouse order inside the reminder window (arrival 21 days away or less, or past) the Hub writes the approved
// message for its phase, with the invoice total / received / remaining from the Hub's own invoices and payments.
//   POST list     — the orders in the window, their figures, what was already sent        (ar.view_invoice_balances)
//   POST preview  — the exact subject and text for one order in one language               (ar.view_invoice_balances)
//   POST send     — sends THAT text by e-mail from info@ktcus.com and logs it              (ar.send_reminders)
//   POST history  — every reminder logged for one order                                    (ar.view_invoice_balances)
// POST never sends by itself: a person looks at the text and presses Send, every time. The only automatic path is GET (v55.83-XY,
// the morning run at the bottom of this file): timer only, and only while the super admin has switched it ON.
// The send is refused unless: the text on screen is still the text the server would write now (figures unchanged), the
// address was typed / confirmed by the person, every warning was acknowledged, and the log row was written first.
// A test send goes only to the signed-in person's own address and never counts as a reminder.
// SWC-safe: var + string concatenation only.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createHash } from 'crypto';
import { assertPermission } from '../../../../lib/server-permissions';
import { verifiedCaller } from '../../../../lib/verified-caller';
import { audit } from '../../../../lib/audit-server';
import { warehouseFeedConfig, feedIdentityProblem } from '../../../../lib/warehouse-feed-config';
import { readFeedBody } from '../../../../lib/warehouse-feed-read'; // v55.83-YA
import { windowFloorFor } from '../../../../lib/visibility-window-server'; // the history window: employees see only the permitted window, in every figure (Max's rule)
import { composeReminder, htmlOf, langOf, todayInNewYork, recipientsOf, LANGS, PHASE_WORDS, AUTO_MAX_PER_RUN, AUTO_MAX_OVERDUE_DAYS, REQUIRED_FROM } from '../../../../lib/arrival-reminders';
import { buildReminderRows, reminderMailConfig, sendReminderMail, readSetting, writeSetting, autoIsOn, AUTO_SWITCH_KEY, AUTO_LAST_RUN_KEY, CC_KEY, ccFor, buildInvoiceAttachments, insertLog } from '../../../../lib/arrival-reminders-server';

export const maxDuration = 60;
var API_BUILD_MARKER = 'v55.83-XG-arrival-reminders';
var SQL_HINT = 'Run sql/v55-83-XG-arrival-reminders.sql in Supabase first (the reminder log). Nothing is sent without the log.';
function admin() { return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } }); }
function bad(msg, st, extra) { return NextResponse.json(Object.assign({ ok: false, error: msg, api_build_marker: API_BUILD_MARKER }, extra || {}), { status: st || 400 }); }
function missingLog(m) { return /arrival_reminders/.test(String(m || '')) && /does not exist|schema cache|not find/i.test(String(m || '')); }
async function fetchAll(q) { var out = []; for (var from = 0; from < 50000; from += 1000) { var r = await q().range(from, from + 999); if (r.error) { throw new Error(r.error.message); } out = out.concat(r.data || []); if (!r.data || r.data.length < 1000) { break; } } return out; }
async function inChunks(db, table, cols, col, ids) { var out = []; for (var i = 0; i < ids.length; i += 200) { var r = await db.from(table).select(cols).in(col, ids.slice(i, i + 200)); if (r.error) { throw new Error(r.error.message); } out = out.concat(r.data || []); } return out; }
function hashOf(subject, body) { return createHash('sha256').update(String(subject) + '\n\n' + String(body), 'utf8').digest('hex'); }

async function fetchFeed(cfg) {
  var ctl = new AbortController(); var tm = setTimeout(function () { ctl.abort(); }, 40000);
  try {
    var res = await fetch(cfg.url + '?shipped_since=2024-01-01', { headers: { 'X-Hub-Feed-Token': cfg.token, Accept: 'application/json' }, signal: ctl.signal, cache: 'no-store', redirect: 'error' });
    var rd = await readFeedBody(res, ctl, 40); // v55.83-YA — a list cut off by the time limit says so plainly (not "answered 200")
    if (res.ok && rd.error) { throw new Error(rd.error); }
    var j = rd.json || null;
    if (!res.ok || !j || j.ok !== true) { throw new Error('The warehouse feed answered ' + res.status + (j && j.error ? ': ' + j.error : '')); }
    var idp = feedIdentityProblem(j, cfg); if (idp) { throw new Error(idp); }
    return j;
  } finally { clearTimeout(tm); }
}

// everything for the screen, read fresh every time (a reminder never states a figure from an old read)
async function loadRows(db, floor) {
  var cfg = warehouseFeedConfig(process.env); if (cfg.error) { return { error: cfg.error }; }
  var feed = await fetchFeed(cfg);
  var invs = await fetchAll(function () { return db.from('accounting_invoices').select('id, invoice_number, release_number, po_so_number, accounting_customer_id, total_amount, wave_imported_paid, currency, record_status, approval_status, wave_status, wave_business_id, wave_invoice_id, source, invoice_date'); });
  var pays = await fetchAll(function () { return db.from('accounting_invoice_payments').select('id, accounting_invoice_id, amount, payment_date, voided, sync_status'); });
  var custIds = {}; invs.forEach(function (i) { if (i.accounting_customer_id) { custIds[i.accounting_customer_id] = true; } });
  var custs = []; var languageReady = true;
  if (Object.keys(custIds).length) {
    try { custs = await inChunks(db, 'accounting_customers', 'id, company_name, contact_name, email, phone, business_tag, correspondence_language', 'id', Object.keys(custIds)); }
    catch (eC) { if (!/correspondence_language/.test(String(eC.message || ''))) { throw eC; } languageReady = false; custs = await inChunks(db, 'accounting_customers', 'id, company_name, contact_name, email, phone, business_tag', 'id', Object.keys(custIds)); } // before sql/v55-83-XY: English for everyone
  }
  var log = []; var logReady = true;
  try { log = await fetchAll(function () { return db.from('arrival_reminders').select('*').eq('source', cfg.source); }); }
  catch (eL) { if (missingLog(eL.message)) { logReady = false; } else { throw eL; } }
  var today = todayInNewYork();
  var built = buildReminderRows({ feed: feed, invoices: invs, payments: pays, customers: custs, log: log, today: today, floor: floor || null });
  return { cfg: cfg, today: today, rows: built.rows, counts: built.counts, logReady: logReady, languageReady: languageReady };
}
// the port of loading: taken from the release prefix when it is 1002 / 1001; for any other prefix it is the text the person
// confirmed on screen (never the warehouse name by itself). It is part of the subject and the text, so of the fingerprint too.
function polTyped(v) { return String(v === null || v === undefined ? '' : v).replace(/[\r\n\t]+/g, ' ').replace(/[{}<>]/g, '').replace(/\s+/g, ' ').trim().substring(0, 60); }
function draftOf(row, lang, pol) {
  var f = row.fields;
  if (row.pol_needs_confirm) {
    var p = polTyped(pol);
    if (!p) { return { ok: false, needs_pol: true, error: 'Release ' + (row.release_number || '') + ' does not start with 1002 (Houston) or 1001 (Canada) — confirm the port of loading first.' }; }
    f = Object.assign({}, row.fields, { pol: p });
  }
  var d = composeReminder(lang, row.phase, f);
  if (!d.ok) { return d; }
  d.draft_hash = hashOf(d.subject, d.body);
  return d;
}

export async function POST(req) {
  var db = admin();
  try {
    var body = await req.json().catch(function () { return {}; });
    var action = String(body.action || '');
    var who = await verifiedCaller(req, body, createClient);
    if (who.error) { return bad(who.error, who.status || 401); }
    var userId = who.userId; if (!userId) { return bad('Sign in again.', 401); }
    var permKey = action === 'send' || action === 'auto_set' || action === 'cc_set' ? 'ar.send_reminders' : 'ar.view_invoice_balances';
    var gate = await assertPermission(db, userId, permKey, req);
    if (!gate || gate.ok !== true) { return bad('This needs the "' + (permKey === 'ar.send_reminders' ? 'AR: Send reminders' : 'AR: View invoice balances') + '" permission — Settings → Module Access.', gate && gate.status ? gate.status : 403); }
    if (['list', 'preview', 'send', 'history', 'auto_set', 'cc_set'].indexOf(action) < 0) { return bad('Unknown action.'); }
    // v55.83-XG (Codex 22 Nov, P1) — the history window applies to EVERY action here (list, preview, send, history), for everyone but
    // the super admin, and fails closed: if the setting cannot be read, nothing is shown and nothing is sent.
    var vwin = await windowFloorFor(db, gate.ctx); if (vwin.error) { return bad(vwin.error, 503); }
    var floor = vwin.floor || null;
    // v55.83-XY — the automatic schedule's switch. ONLY the super admin turns it on or off; turning it on needs an explicit confirmation.
    if (action === 'auto_set') {
      if (!gate.ctx || gate.ctx.isSuperAdmin !== true) { return bad('Only the super admin can switch automatic reminders on or off.', 403); }
      if (body.enabled !== true && body.enabled !== false) { return bad('Say on or off.'); }
      if (body.enabled === true && body.confirm !== true) { return bad('Switching automatic sending ON needs your confirmation.'); }
      var meS = await db.from('users').select('id, name, email').eq('id', userId).maybeSingle(); var meSR = (meS && meS.data) || {};
      var val = { enabled: body.enabled, by: userId, by_name: meSR.name || meSR.email || null, at: new Date().toISOString() };
      var wS = await writeSetting(db, AUTO_SWITCH_KEY, val, userId);
      if (wS.error) { return bad('The switch could not be saved (' + wS.error + ') — automatic sending is unchanged.', 503); }
      try { await audit(db, userId, body.enabled ? 'arrival_reminders_auto_on' : 'arrival_reminders_auto_off', 'setting', AUTO_SWITCH_KEY, val); } catch (eAu) { /* the setting row itself records who and when */ }
      return NextResponse.json({ ok: true, auto: { on: body.enabled, by_name: val.by_name, at: val.at }, api_build_marker: API_BUILD_MARKER });
    }
    // v55.83-XY — who is copied on every customer reminder. A setting; ONLY the super admin changes it.
    if (action === 'cc_set') {
      if (!gate.ctx || gate.ctx.isSuperAdmin !== true) { return bad('Only the super admin can change who is copied on the reminders.', 403); }
      var rcC = recipientsOf(body.cc);
      if (rcC.bad.length) { return bad('Not an e-mail address: ' + rcC.bad.join(', ') + ' — the copy list is unchanged.'); }
      var wC = await writeSetting(db, CC_KEY, { list: rcC.list, by: userId, at: new Date().toISOString() }, userId);
      if (wC.error) { return bad('The copy list could not be saved (' + wC.error + ') — it is unchanged.', 503); }
      try { await audit(db, userId, 'arrival_reminders_cc_set', 'setting', CC_KEY, { list: rcC.list }); } catch (eAc) { /* the setting row records it */ }
      return NextResponse.json({ ok: true, cc: rcC.list, api_build_marker: API_BUILD_MARKER });
    }
    var all = await loadRows(db, floor);
    if (all.error) { return bad(all.error, 503); }

    if (action === 'history') {
      var cfgH = all.cfg;
      var h = await db.from('arrival_reminders').select('*')
        .eq('source', cfgH.source).eq('order_id', Number(body.order_id) || 0).order('created_at', { ascending: false }).limit(200);
      if (h.error) { return bad(missingLog(h.error.message) ? SQL_HINT : h.error.message, missingLog(h.error.message) ? 503 : 500); }
      // a person with a history window is given a logged text and its amounts only for an order they may see in full TODAY, and only
      // for a log entry inside their window; otherwise the entry is listed (when, to whom, stage, outcome) with the text and the
      // amounts withheld. An old balance is never shown just because it sits in a newer log row.
      var rowH = null; all.rows.forEach(function (r) { if (r.order_id === Number(body.order_id)) { rowH = r; } });
      var outH = (h.data || []).map(function (x) {
        var open = !floor || (rowH && !rowH.limited && String(x.created_at || '').substring(0, 10) >= floor);
        return open ? Object.assign({}, x, { withheld: false }) : Object.assign({}, x, { body: null, subject: null, total: null, received: null, remaining: null, withheld: true });
      });
      return NextResponse.json({ ok: true, rows: outH, window_floor: floor, api_build_marker: API_BUILD_MARKER });
    }

    var mailCfg = reminderMailConfig();
    var mailbox = { configured: mailCfg.configured && mailCfg.from_ok, from: mailCfg.user || null, wrong_from: !!mailCfg.wrong_from, required_from: REQUIRED_FROM };
    var ccNow = await ccFor(db);

    if (action === 'list') {
      // the switch and the last morning run, for the top of the screen (an unreadable switch is shown as unreadable, and counts as OFF)
      var sw = await readSetting(db, AUTO_SWITCH_KEY); var lr = await readSetting(db, AUTO_LAST_RUN_KEY);
      var autoInfo = { on: autoIsOn(sw), unreadable: !!sw.error, by_name: sw.value ? sw.value.by_name || null : null, at: sw.value ? sw.value.at || null : null, last_run: floor ? null : (lr.value || null),
        can_switch: !!(gate.ctx && gate.ctx.isSuperAdmin === true), live_feed: all.cfg.source === 'nextrade-live', schedule: 'Every morning at 12:00 UTC (7:00 in New York in winter, 8:00 in summer), with a second pass one hour later.', max_overdue_days: AUTO_MAX_OVERDUE_DAYS,
        would_send: all.rows.filter(function (r) { return r.auto && r.auto.eligible; }).length };
      return NextResponse.json({ ok: true, auto: autoInfo, cc: ccNow, language_ready: all.languageReady, source: all.cfg.source, today: all.today, window_floor: floor, rows: all.rows, counts: all.counts, log_ready: all.logReady, sql_hint: all.logReady ? null : SQL_HINT, mailbox: mailbox,
        languages: LANGS, phase_words: PHASE_WORDS, api_build_marker: API_BUILD_MARKER });
    }

    var row = null; all.rows.forEach(function (r) { if (r.order_id === Number(body.order_id)) { row = r; } });
    if (!row) { return bad('That order is not in the reminder window any more (closed, no arrival date, or more than 21 days away).', 404); }
    var lang = langOf(body.lang || row.language);

    if (action === 'preview') {
      if (row.blocks.length) { return NextResponse.json({ ok: true, can_send: false, row: row, blocks: row.blocks, warnings: row.warnings, mailbox: mailbox, log_ready: all.logReady, api_build_marker: API_BUILD_MARKER }); }
      var d = draftOf(row, lang, body.pol);
      if (!d.ok) { return NextResponse.json({ ok: true, can_send: false, needs_pol: !!d.needs_pol, row: row, blocks: [d.error], warnings: row.warnings, mailbox: mailbox, log_ready: all.logReady, api_build_marker: API_BUILD_MARKER }); }
      // what will go with it: the copy list, and a PDF of each invoice (made now, so the person sees what will or will not be attached)
      var attP = await buildInvoiceAttachments(db, row.invoices.map(function (x) { return x.id; }));
      return NextResponse.json({ ok: true, can_send: all.logReady && mailbox.configured, cc: ccNow, attachments: attP.names, attachment_note: attP.note, row: row, lang: d.lang, rtl: d.rtl, subject: d.subject, body: d.body, draft_hash: d.draft_hash, to: row.email, blocks: [], warnings: row.warnings,
        mailbox: mailbox, log_ready: all.logReady, sql_hint: all.logReady ? null : SQL_HINT, api_build_marker: API_BUILD_MARKER });
    }

    // ── send ──
    if (!all.logReady) { return bad(SQL_HINT, 503); }
    if (mailbox.wrong_from) { return bad('The mailbox connected on the server is ' + mailbox.from + ', not ' + REQUIRED_FROM + ' — reminders are only sent from ' + REQUIRED_FROM + '. Nothing was sent.', 503, { wrong_from: true }); }
    if (!mailbox.configured) { return bad('The info@ktcus.com mailbox is not connected on the server (COMMERCIAL_MAIL_USER and COMMERCIAL_MAIL_PASSWORD in Vercel) — nothing was sent.', 503); }
    if (body.confirm !== true) { return bad('Sending needs the person’s confirmation.'); }
    if (row.blocks.length) { return bad('This reminder cannot be sent: ' + row.blocks.join(' '), 409, { blocks: row.blocks }); }
    var dS = draftOf(row, lang, body.pol);
    if (!dS.ok) { return bad(dS.error, 409); }
    if (!body.draft_hash || String(body.draft_hash) !== dS.draft_hash) { return bad('The figures or the text changed since you looked at it — nothing was sent. Look at the reminder again.', 409, { changed: true }); }
    if (row.warnings.length && body.ack_warnings !== true) { return bad('Tick that you checked the warning(s) first — nothing was sent.', 409, { warnings: row.warnings }); }
    var me = await db.from('users').select('id, name, email').eq('id', userId).maybeSingle();
    var meRow = (me && me.data) || {};
    var isTest = body.test === true;
    // v55.83-XY — the customer may have several addresses (the warehouse field is free text): every one must be a plain address
    var rcTo = recipientsOf(isTest ? meRow.email : body.to);
    var to = rcTo.bad.length ? '' : rcTo.list.join(', ');
    if (!to) { return bad(isTest ? 'Your own e-mail address is not on your Hub profile — a test cannot be sent.' : 'Type the customer’s e-mail address — nothing was sent.'); }
    if (!isTest && recipientsOf(body.confirm_to).list.join(', ').toLowerCase() !== to.toLowerCase()) { return bad('The address was not confirmed — nothing was sent.'); }
    // v55.83-XG (Codex 22 Nov, P2) — an earlier attempt for this stage whose delivery is unconfirmed (the mail server never answered, or
    // the send never finished) may have reached the customer. It is never retried as if nothing happened: the person must say they
    // checked and still want another one sent. This is a separate tick from "send another one" after a confirmed send.
    if (!isTest && row.slot_unconfirmed && body.resend_after_unconfirmed !== true) { return bad('An earlier reminder for this stage may already have reached the customer (delivery unconfirmed). Open the history, check, and tick "I checked — send another" if it is still right to send.', 409, { delivery_unconfirmed: true }); }
    if (!isTest && row.slot_sent && body.again !== true) { return bad('A reminder for this stage (' + row.slot + ') was already sent for this order. Tick "send again" if you really mean to send another.', 409, { already_sent: true }); }
    var subject = (isTest ? '[TEST — not sent to the customer] ' : '') + dS.subject;
    // v55.83-XY — the office is copied on every customer reminder, never on a test; the invoice PDF(s) go with both. A PDF that cannot be
    // made never stops the reminder (Max: "SEND IT ANYWAY"): the log row says it went without the invoice, and why.
    var ccSend = isTest ? [] : ccNow;
    var att = await buildInvoiceAttachments(db, row.invoices.map(function (x) { return x.id; }));
    var extraLog = { cc: ccSend.join(', ') || null, invoices_attached: att.attachments.length, attachment_note: att.note };
    var ins = await insertLog(db, extraLog, { source: all.cfg.source, order_id: row.order_id, release_number: row.release_number, release_key: row.release_key, customer_name: row.hub_customer || row.customer,
      invoice_ids: row.invoices.map(function (i) { return i.id; }), channel: 'email', mode: isTest ? 'test' : 'manual', phase: row.phase, slot: row.slot, language: dS.lang, sent_to: to, subject: subject, body: dS.body,
      arrival_date: row.arrival_date, days_to_arrival: row.days, total: row.balance.total, received: row.balance.received, remaining: row.balance.remaining, status: 'sending', sent_by: userId, sent_by_name: meRow.name || meRow.email || null });
    if (ins.error || !ins.data) { return bad('The reminder could not be logged, so it was NOT sent' + (ins.error ? ': ' + (missingLog(ins.error.message) ? SQL_HINT : ins.error.message) : '.'), 503); }
    var logId = ins.data.id;
    var sent = await sendReminderMail({ to: to, cc: ccSend, attachments: att.attachments, subject: subject, text: dS.body, html: htmlOf(dS.body, dS.rtl), id: logId }, { config: mailCfg });
    if (!sent.ok) {
      // a definite refusal = 'failed' (it can simply be tried again); no answer = 'unknown' (delivery unconfirmed — never "not sent")
      await db.from('arrival_reminders').update({ status: sent.outcome_unknown ? 'unknown' : 'failed', error: String(sent.error || '').substring(0, 500) }).eq('id', logId).eq('status', 'sending');
      try { await audit(db, userId, sent.outcome_unknown ? 'arrival_reminder_delivery_unconfirmed' : 'arrival_reminder_send_failed', 'warehouse_order', String(row.order_id), { log: logId, release: row.release_number, to: to, test: isTest, error: sent.error, outcome_unknown: !!sent.outcome_unknown }); } catch (eA) { /* the log row holds the reason */ }
      return bad((sent.outcome_unknown ? 'Delivery unconfirmed: ' : 'Not sent: ') + sent.error, 502, { outcome_unknown: !!sent.outcome_unknown, delivery_unconfirmed: !!sent.outcome_unknown, log_id: logId });
    }
    var upd = await db.from('arrival_reminders').update({ status: 'sent', sent_at: new Date().toISOString(), message_id: sent.message_id, smtp_response: sent.smtp_response }).eq('id', logId).eq('status', 'sending').select('id');
    try { await audit(db, userId, isTest ? 'arrival_reminder_test_sent' : 'arrival_reminder_sent', 'warehouse_order', String(row.order_id), { log: logId, release: row.release_number, to: to, phase: row.phase, slot: row.slot, language: dS.lang, remaining: row.balance.remaining, message_id: sent.message_id, cc: ccSend, invoices_attached: att.names, attachment_note: att.note, sent_again_after_a_confirmed_send: !isTest && row.slot_sent ? true : null, sent_after_checking_an_unconfirmed_delivery: !isTest && row.slot_unconfirmed ? true : null, port_of_loading_confirmed_by_person: row.pol_needs_confirm ? polTyped(body.pol) : null }); } catch (eA2) { /* ok */ }
    return NextResponse.json({ ok: true, sent: true, test: isTest, to: to, from: sent.from, log_id: logId, logged: !!(upd && upd.data && upd.data.length), copied_to_sent: sent.copied_to_sent, rejected: sent.rejected || [], cc: ccSend, attachments: att.names, attachment_note: att.note, api_build_marker: API_BUILD_MARKER });
  } catch (e) {
    return bad((e && e.message) || 'The reminder request failed.', 500);
  }
}

// ── v55.83-XY — THE MORNING RUN (Max, 23 Nov 2026: "this needs to be automated at beginning of the day of the time email is needed") ──
// GET, Vercel timer only (CRON_SECRET, at least 16 characters). It does nothing unless ALL of these hold: the super admin switched
// automatic sending ON · the switch could be read · the Hub is reading the LIVE warehouse (never the staging copy) · the log table and
// the mailbox are there. Then, for each order whose stage has not been sent yet and where nothing needs a person (autoCheck: no block,
// no warning, a certain port of loading, an e-mail on the WAREHOUSE customer, no unconfirmed earlier send), it writes the approved
// text in the customer's language and sends it. NEVER TWICE: the log row is inserted first as mode 'auto' / 'sending', and the
// database's own unique index (source, order, channel, slot) refuses a second one — two timers at once, or a second pass, send once.
// A definite refusal by the mail server is 'failed' (tried again next morning, at most twice per stage); no answer is 'unknown'
// (delivery unconfirmed): it holds the stage and waits for a person — the schedule never retries it.
function isTimer(req) { var s = process.env.CRON_SECRET || ''; var h = ''; try { h = (req && req.headers && req.headers.get && req.headers.get('authorization')) || ''; } catch (eH) { h = ''; } return s.length >= 16 && h === 'Bearer ' + s; }
export async function GET(req) {
  if (!isTimer(req)) { return bad('Timer only.', 401); }
  var db = admin(); var started = Date.now();
  var run = { at: new Date().toISOString(), today: todayInNewYork(), sent: [], failed: [], unconfirmed: [], skipped: [], needs_person: 0, note: null };
  async function finish(note, status) {
    run.note = note || null; run.took_ms = Date.now() - started;
    try { await writeSetting(db, AUTO_LAST_RUN_KEY, run, null); } catch (eW) { /* the audit rows and the log hold every send */ }
    return NextResponse.json({ ok: !status || status < 400, run: run, api_build_marker: API_BUILD_MARKER }, { status: status || 200 });
  }
  try {
    var sw = await readSetting(db, AUTO_SWITCH_KEY);
    if (sw.error) { return finish('The on / off switch could not be read (' + sw.error + ') — nothing was sent.', 503); }
    if (!autoIsOn(sw)) { return NextResponse.json({ ok: true, off: true, sent: 0, api_build_marker: API_BUILD_MARKER }); } // OFF: nothing is read, nothing is recorded
    var mailCfg = reminderMailConfig();
    if (mailCfg.wrong_from) { return finish('The mailbox connected on the server is ' + mailCfg.user + ', not ' + REQUIRED_FROM + ' — nothing was sent.', 503); }
    if (!mailCfg.configured) { return finish('The mailbox is not connected on the server — nothing was sent.', 503); }
    var ccAuto = await ccFor(db);
    var all = await loadRows(db, null);
    if (all.error) { return finish(all.error + ' Nothing was sent.', 503); }
    if (all.cfg.source !== 'nextrade-live') { return finish('The Hub is reading the ' + all.cfg.source + ' copy of the warehouse, not the live one — automatic reminders are never sent from a test copy.', 200); }
    if (!all.logReady) { return finish(SQL_HINT, 503); }
    run.needs_person = all.rows.filter(function (r) { return !r.paid_in_full && (!r.auto || !r.auto.eligible); }).filter(function (r) { return !r.slot_sent; }).length; // a paid order waits for nobody
    var todo = all.rows.filter(function (r) { return r.auto && r.auto.eligible; });
    for (var i = 0; i < todo.length; i++) {
      var row = todo[i]; var tag = { order_id: row.order_id, release: row.release_number, slot: row.slot };
      if (run.sent.length + run.failed.length + run.unconfirmed.length >= AUTO_MAX_PER_RUN || Date.now() - started > 42000) { run.skipped.push(Object.assign({ why: 'left for the next pass (time / number limit of one run)' }, tag)); continue; }
      var d = draftOf(row, row.language, null);
      if (!d.ok) { run.skipped.push(Object.assign({ why: d.error }, tag)); continue; }
      var to = row.recipients.join(', ');
      var att = await buildInvoiceAttachments(db, row.invoices.map(function (x) { return x.id; }));
      var ins = await insertLog(db, { cc: ccAuto.join(', ') || null, invoices_attached: att.attachments.length, attachment_note: att.note }, { source: all.cfg.source, order_id: row.order_id, release_number: row.release_number, release_key: row.release_key, customer_name: row.hub_customer || row.customer,
        invoice_ids: row.invoices.map(function (x) { return x.id; }), channel: 'email', mode: 'auto', phase: row.phase, slot: row.slot, language: d.lang, sent_to: to, subject: d.subject, body: d.body,
        arrival_date: row.arrival_date, days_to_arrival: row.days, total: row.balance.total, received: row.balance.received, remaining: row.balance.remaining, status: 'sending', sent_by: null, sent_by_name: 'Automatic schedule' });
      if (ins.error || !ins.data) { run.skipped.push(Object.assign({ why: 'not sent — the stage was already taken or the log refused the row (' + ((ins.error && ins.error.message) || 'no row') + ')' }, tag)); continue; }
      var logId = ins.data.id;
      var sent = await sendReminderMail({ to: to, cc: ccAuto, attachments: att.attachments, subject: d.subject, text: d.body, html: htmlOf(d.body, d.rtl), id: logId }, { config: mailCfg });
      if (!sent.ok) {
        await db.from('arrival_reminders').update({ status: sent.outcome_unknown ? 'unknown' : 'failed', error: String(sent.error || '').substring(0, 500) }).eq('id', logId).eq('status', 'sending');
        try { await audit(db, null, sent.outcome_unknown ? 'arrival_reminder_delivery_unconfirmed' : 'arrival_reminder_send_failed', 'warehouse_order', String(row.order_id), { log: logId, release: row.release_number, to: to, automatic: true, error: sent.error, outcome_unknown: !!sent.outcome_unknown }); } catch (eA) { /* the log row holds it */ }
        (sent.outcome_unknown ? run.unconfirmed : run.failed).push(Object.assign({ to: to, why: String(sent.error || '').substring(0, 200) }, tag));
        continue;
      }
      await db.from('arrival_reminders').update({ status: 'sent', sent_at: new Date().toISOString(), message_id: sent.message_id, smtp_response: sent.smtp_response }).eq('id', logId).eq('status', 'sending');
      try { await audit(db, null, 'arrival_reminder_sent', 'warehouse_order', String(row.order_id), { log: logId, release: row.release_number, to: to, phase: row.phase, slot: row.slot, language: d.lang, remaining: row.balance.remaining, message_id: sent.message_id, automatic: true, cc: ccAuto, invoices_attached: att.names, attachment_note: att.note, rejected: sent.rejected || [] }); } catch (eA2) { /* ok */ }
      run.sent.push(Object.assign({ to: to, language: d.lang, remaining: row.balance.remaining, invoices_attached: att.attachments.length, attachment_note: att.note }, tag));
    }
    return finish(null, 200);
  } catch (e) {
    return finish('The morning run stopped: ' + ((e && e.message) || 'error') + '. Whatever was sent before that is in the log.', 500);
  }
}
