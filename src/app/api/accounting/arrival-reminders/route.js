// /api/accounting/arrival-reminders — v55.83-XG (Max, 22 Nov 2026). ARRIVAL + FINAL-PAYMENT REMINDERS, Phase 1: e-mail, by hand.
// For each warehouse order inside the reminder window (arrival 21 days away or less, or past) the Hub writes the approved
// message for its phase, with the invoice total / received / remaining from the Hub's own invoices and payments.
//   POST list     — the orders in the window, their figures, what was already sent        (ar.view_invoice_balances)
//   POST preview  — the exact subject and text for one order in one language               (ar.view_invoice_balances)
//   POST send     — sends THAT text by e-mail from info@ktcus.com and logs it              (ar.send_reminders)
//   POST history  — every reminder logged for one order                                    (ar.view_invoice_balances)
// Nothing here sends by itself: there is no timer and no GET. A person looks at the text and presses Send, every time.
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
import { isEmail } from '../../../../lib/commercial-mail';
import { composeReminder, htmlOf, langOf, todayInNewYork, LANGS, PHASE_WORDS } from '../../../../lib/arrival-reminders';
import { buildReminderRows, reminderMailConfig, sendReminderMail } from '../../../../lib/arrival-reminders-server';

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
  var custs = Object.keys(custIds).length ? await inChunks(db, 'accounting_customers', 'id, company_name, contact_name, email, phone, business_tag', 'id', Object.keys(custIds)) : [];
  var log = []; var logReady = true;
  try { log = await fetchAll(function () { return db.from('arrival_reminders').select('id, order_id, channel, mode, phase, slot, language, sent_to, status, error, total, received, remaining, created_at, sent_at, sent_by_name').eq('source', cfg.source); }); }
  catch (eL) { if (missingLog(eL.message)) { logReady = false; } else { throw eL; } }
  var today = todayInNewYork();
  var built = buildReminderRows({ feed: feed, invoices: invs, payments: pays, customers: custs, log: log, today: today, floor: floor || null });
  return { cfg: cfg, today: today, rows: built.rows, counts: built.counts, logReady: logReady };
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
    var permKey = action === 'send' ? 'ar.send_reminders' : 'ar.view_invoice_balances';
    var gate = await assertPermission(db, userId, permKey, req);
    if (!gate || gate.ok !== true) { return bad('This needs the "' + (permKey === 'ar.send_reminders' ? 'AR: Send reminders' : 'AR: View invoice balances') + '" permission — Settings → Module Access.', gate && gate.status ? gate.status : 403); }
    if (['list', 'preview', 'send', 'history'].indexOf(action) < 0) { return bad('Unknown action.'); }
    // v55.83-XG (Codex 22 Nov, P1) — the history window applies to EVERY action here (list, preview, send, history), for everyone but
    // the super admin, and fails closed: if the setting cannot be read, nothing is shown and nothing is sent.
    var vwin = await windowFloorFor(db, gate.ctx); if (vwin.error) { return bad(vwin.error, 503); }
    var floor = vwin.floor || null;
    var all = await loadRows(db, floor);
    if (all.error) { return bad(all.error, 503); }

    if (action === 'history') {
      var cfgH = all.cfg;
      var h = await db.from('arrival_reminders').select('id, order_id, release_number, channel, mode, phase, slot, language, sent_to, subject, body, total, received, remaining, arrival_date, days_to_arrival, status, error, sent_by_name, created_at, sent_at')
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
    var mailbox = { configured: mailCfg.configured, from: mailCfg.configured ? mailCfg.user : null };

    if (action === 'list') {
      return NextResponse.json({ ok: true, source: all.cfg.source, today: all.today, window_floor: floor, rows: all.rows, counts: all.counts, log_ready: all.logReady, sql_hint: all.logReady ? null : SQL_HINT, mailbox: mailbox,
        languages: LANGS, phase_words: PHASE_WORDS, api_build_marker: API_BUILD_MARKER });
    }

    var row = null; all.rows.forEach(function (r) { if (r.order_id === Number(body.order_id)) { row = r; } });
    if (!row) { return bad('That order is not in the reminder window any more (closed, no arrival date, or more than 21 days away).', 404); }
    var lang = langOf(body.lang || row.language);

    if (action === 'preview') {
      if (row.blocks.length) { return NextResponse.json({ ok: true, can_send: false, row: row, blocks: row.blocks, warnings: row.warnings, mailbox: mailbox, log_ready: all.logReady, api_build_marker: API_BUILD_MARKER }); }
      var d = draftOf(row, lang, body.pol);
      if (!d.ok) { return NextResponse.json({ ok: true, can_send: false, needs_pol: !!d.needs_pol, row: row, blocks: [d.error], warnings: row.warnings, mailbox: mailbox, log_ready: all.logReady, api_build_marker: API_BUILD_MARKER }); }
      return NextResponse.json({ ok: true, can_send: all.logReady && mailbox.configured, row: row, lang: d.lang, rtl: d.rtl, subject: d.subject, body: d.body, draft_hash: d.draft_hash, to: row.email, blocks: [], warnings: row.warnings,
        mailbox: mailbox, log_ready: all.logReady, sql_hint: all.logReady ? null : SQL_HINT, api_build_marker: API_BUILD_MARKER });
    }

    // ── send ──
    if (!all.logReady) { return bad(SQL_HINT, 503); }
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
    var to = isTest ? String(meRow.email || '').trim() : String(body.to || '').trim();
    if (!isEmail(to)) { return bad(isTest ? 'Your own e-mail address is not on your Hub profile — a test cannot be sent.' : 'Type the customer’s e-mail address — nothing was sent.'); }
    if (!isTest && String(body.confirm_to || '').trim().toLowerCase() !== to.toLowerCase()) { return bad('The address was not confirmed — nothing was sent.'); }
    // v55.83-XG (Codex 22 Nov, P2) — an earlier attempt for this stage whose delivery is unconfirmed (the mail server never answered, or
    // the send never finished) may have reached the customer. It is never retried as if nothing happened: the person must say they
    // checked and still want another one sent. This is a separate tick from "send another one" after a confirmed send.
    if (!isTest && row.slot_unconfirmed && body.resend_after_unconfirmed !== true) { return bad('An earlier reminder for this stage may already have reached the customer (delivery unconfirmed). Open the history, check, and tick "I checked — send another" if it is still right to send.', 409, { delivery_unconfirmed: true }); }
    if (!isTest && row.slot_sent && body.again !== true) { return bad('A reminder for this stage (' + row.slot + ') was already sent for this order. Tick "send again" if you really mean to send another.', 409, { already_sent: true }); }
    var subject = (isTest ? '[TEST — not sent to the customer] ' : '') + dS.subject;
    var ins = await db.from('arrival_reminders').insert({ source: all.cfg.source, order_id: row.order_id, release_number: row.release_number, release_key: row.release_key, customer_name: row.hub_customer || row.customer,
      invoice_ids: row.invoices.map(function (i) { return i.id; }), channel: 'email', mode: isTest ? 'test' : 'manual', phase: row.phase, slot: row.slot, language: dS.lang, sent_to: to, subject: subject, body: dS.body,
      arrival_date: row.arrival_date, days_to_arrival: row.days, total: row.balance.total, received: row.balance.received, remaining: row.balance.remaining, status: 'sending', sent_by: userId, sent_by_name: meRow.name || meRow.email || null }).select('id').maybeSingle();
    if (ins.error || !ins.data) { return bad('The reminder could not be logged, so it was NOT sent' + (ins.error ? ': ' + (missingLog(ins.error.message) ? SQL_HINT : ins.error.message) : '.'), 503); }
    var logId = ins.data.id;
    var sent = await sendReminderMail({ to: to, subject: subject, text: dS.body, html: htmlOf(dS.body, dS.rtl), id: logId }, { config: mailCfg });
    if (!sent.ok) {
      // a definite refusal = 'failed' (it can simply be tried again); no answer = 'unknown' (delivery unconfirmed — never "not sent")
      await db.from('arrival_reminders').update({ status: sent.outcome_unknown ? 'unknown' : 'failed', error: String(sent.error || '').substring(0, 500) }).eq('id', logId).eq('status', 'sending');
      try { await audit(db, userId, sent.outcome_unknown ? 'arrival_reminder_delivery_unconfirmed' : 'arrival_reminder_send_failed', 'warehouse_order', String(row.order_id), { log: logId, release: row.release_number, to: to, test: isTest, error: sent.error, outcome_unknown: !!sent.outcome_unknown }); } catch (eA) { /* the log row holds the reason */ }
      return bad((sent.outcome_unknown ? 'Delivery unconfirmed: ' : 'Not sent: ') + sent.error, 502, { outcome_unknown: !!sent.outcome_unknown, delivery_unconfirmed: !!sent.outcome_unknown, log_id: logId });
    }
    var upd = await db.from('arrival_reminders').update({ status: 'sent', sent_at: new Date().toISOString(), message_id: sent.message_id, smtp_response: sent.smtp_response }).eq('id', logId).eq('status', 'sending').select('id');
    try { await audit(db, userId, isTest ? 'arrival_reminder_test_sent' : 'arrival_reminder_sent', 'warehouse_order', String(row.order_id), { log: logId, release: row.release_number, to: to, phase: row.phase, slot: row.slot, language: dS.lang, remaining: row.balance.remaining, message_id: sent.message_id, sent_again_after_a_confirmed_send: !isTest && row.slot_sent ? true : null, sent_after_checking_an_unconfirmed_delivery: !isTest && row.slot_unconfirmed ? true : null, port_of_loading_confirmed_by_person: row.pol_needs_confirm ? polTyped(body.pol) : null }); } catch (eA2) { /* ok */ }
    return NextResponse.json({ ok: true, sent: true, test: isTest, to: to, from: sent.from, log_id: logId, logged: !!(upd && upd.data && upd.data.length), copied_to_sent: sent.copied_to_sent, api_build_marker: API_BUILD_MARKER });
  } catch (e) {
    return bad((e && e.message) || 'The reminder request failed.', 500);
  }
}
