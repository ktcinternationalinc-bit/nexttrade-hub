// /api/accounting/order-monitor — v55.83-TI (Max, Nov 16 2026). ORDER LIFECYCLE, EXCEPTIONS, DEPOSITS, 30-HOUR ALERT, OVERNIGHT REVIEW.
// Reads the Nextrade warehouse (read-only feed; staging until Max says production), joins the Hub's invoices / payments / bills by
// RELEASE NUMBER, and applies the rules in lib/order-lifecycle.js.
//   GET  ?job=deadline  — every 15 min (Vercel cron, CRON_SECRET): the 30-hour check + alerts
//   GET  ?job=nightly   — every night 02:30 New York: full review, automatic closure (when switched on), summary
//   POST action=ping    — Nextrade calls this right after a stage is saved (X-Hub-Feed-Token); runs the 30-hour check
//   POST report · order · deposit_candidates · set_deposit_status · link_deposit · unlink_deposit · override · end_override ·
//        close_order · settings · run_now  — signed-in users (verified sign-in token)
// SWC-safe: var + string concatenation only.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { assertPermission } from '../../../../lib/server-permissions';
import { verifiedCaller } from '../../../../lib/verified-caller';
import { audit } from '../../../../lib/audit-server';
import { sendAlertEmail } from '../../../../lib/notify-server';
import { evaluateOrder, releasesOf, alertEmail, stageRank, ALERT_RECIPIENTS_DEFAULT, reconcileReleases } from '../../../../lib/order-lifecycle';
import { relKey, isTransportLine } from '../../../../lib/profitability';
import { privateScope, dropPrivate, isPrivateRow } from '../../../../lib/private-accounts-server'; // v55.83-TP — private bank accounts

export const maxDuration = 60;
var API_BUILD_MARKER = 'v55.83-TI-order-monitor';
var SQL_HINT = 'Run sql/v55-83-TI-order-monitor.sql in Supabase first.';
var HUB_URL = 'https://nexttrade-hub.vercel.app'; // the Hub's real address (hub.ktcus.com was never connected)
function admin() { return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } }); }
function bad(msg, st) { return NextResponse.json({ ok: false, error: msg, api_build_marker: API_BUILD_MARKER }, { status: st || 400 }); }
function r2(x) { return Math.round((Number(x) || 0) * 100) / 100; }
function missingTable(m) { return /order_(monitor|deposit|alerts|review|closures)/.test(String(m || '')) && /does not exist|schema cache|not find/i.test(String(m || '')); }
async function fetchAll(q) { var out = []; for (var from = 0; from < 50000; from += 1000) { var r = await q().range(from, from + 999); if (r.error) { throw new Error(r.error.message); } out = out.concat(r.data || []); if (!r.data || r.data.length < 1000) { break; } } return out; }
async function inChunks(db, table, cols, col, ids) { var out = []; for (var i = 0; i < ids.length; i += 200) { var r = await db.from(table).select(cols).in(col, ids.slice(i, i + 200)); if (r.error) { throw new Error(r.error.message); } out = out.concat(r.data || []); } return out; }

// ── the warehouse feed (same address and token as the shipping-cost sync) ──
function feedConfig() {
  var url = String(process.env.NEXTRADE_FEED_URL || '').trim(); var token = String(process.env.NEXTRADE_FEED_TOKEN || '').trim();
  if (!url || !token) { return { error: 'The warehouse feed is not set up (NEXTRADE_FEED_URL / NEXTRADE_FEED_TOKEN in Vercel).' }; }
  var host = ''; try { host = new URL(url).host; } catch (e) { return { error: 'NEXTRADE_FEED_URL is not a web address.' }; }
  var live = !/nextrade-staging\.com$/i.test(host);
  if (live && String(process.env.NEXTRADE_FEED_ALLOW_LIVE || '') !== 'yes') { return { error: 'The feed points at the LIVE warehouse; that needs Max’s go-ahead (NEXTRADE_FEED_ALLOW_LIVE=yes).' }; }
  return { url: url, token: token, host: host, source: live ? 'nextrade-live' : 'nextrade-staging', closeUrl: url.replace(/\/shipping\/?$/, '/close-order'), closeToken: String(process.env.NEXTRADE_CLOSE_TOKEN || '').trim() }; // TO — closing has its OWN token (Codex P1), never the read token
}
async function fetchFeed(cfg) {
  var ctl = new AbortController(); var tm = setTimeout(function () { ctl.abort(); }, 40000);
  try {
    var res = await fetch(cfg.url + '?shipped_since=2024-01-01', { headers: { 'X-Hub-Feed-Token': cfg.token, Accept: 'application/json' }, signal: ctl.signal, cache: 'no-store' });
    var j = await res.json().catch(function () { return null; });
    if (!res.ok || !j || j.ok !== true) { throw new Error('The warehouse feed answered ' + res.status + (j && j.error ? ': ' + j.error : '')); }
    if (j.source && j.source !== cfg.source) { throw new Error('The feed says it is ' + j.source + ', the Hub expected ' + cfg.source + '.'); }
    return j;
  } finally { clearTimeout(tm); }
}
function latestRow(rows) { return rows.slice().sort(function (a, b) { return String(a.updated_at || '').localeCompare(String(b.updated_at || '')) || (Number(a.id) - Number(b.id)); }).pop() || null; }

// ── everything, evaluated ──
async function loadAll(db, opts) {
  var cfg = feedConfig(); if (cfg.error) { return { error: cfg.error }; }
  var feed = await fetchFeed(cfg);
  var nowMs = Date.now();
  var stagesBy = {}; (Array.isArray(feed.requirements) ? feed.requirements : (feed.stages || [])).forEach(function (s) { var k = s.order_id; (stagesBy[k] = stagesBy[k] || {}); (stagesBy[k][s.order_status] = stagesBy[k][s.order_status] || []).push(s); });
  var histBy = {}; (feed.status_history || []).forEach(function (h) { (histBy[h.order_id] = histBy[h.order_id] || []).push(h); });
  var obsRel = {}; (feed.obsolete_orders || []).forEach(function (o) { var k = relKey(o.release_number); if (k) { obsRel[k] = true; } });
  var mainRelCount = {}; (feed.orders || []).forEach(function (o) { var k = relKey(o.release_number); if (k && o.status !== 'cancelled') { mainRelCount[k] = (mainRelCount[k] || 0) + 1; } });
  // Hub side
  var invs = await fetchAll(function () { return db.from('accounting_invoices').select('id, invoice_number, release_number, po_so_number, accounting_customer_id, total_amount, wave_imported_paid, record_status, approval_status, wave_sync_status, invoice_date'); });
  var custIds = {}; invs.forEach(function (i) { if (i.accounting_customer_id) { custIds[i.accounting_customer_id] = true; } });
  var custs = Object.keys(custIds).length ? await inChunks(db, 'accounting_customers', 'id, company_name, contact_name', 'id', Object.keys(custIds)) : [];
  var custName = {}; custs.forEach(function (c) { custName[c.id] = c.company_name || c.contact_name || null; });
  var invByRel = {}; var poByRel = {};
  invs.forEach(function (i) { releasesOf(i.release_number).forEach(function (k) { (invByRel[k] = invByRel[k] || []).push(i); }); releasesOf(i.po_so_number).forEach(function (k) { (poByRel[k] = poByRel[k] || []).push(i); }); });
  var pays = await fetchAll(function () { return db.from('accounting_invoice_payments').select('accounting_invoice_id, amount, bank_transaction_id, voided'); });
  var paysBy = {}; pays.forEach(function (p) { if (p.voided !== true) { (paysBy[p.accounting_invoice_id] = paysBy[p.accounting_invoice_id] || []).push(p); } });
  var termsBy = {}; try { (await fetchAll(function () { return db.from('pl_invoice_terms').select('invoice_id, shipping_terms'); })).forEach(function (t) { termsBy[t.invoice_id] = t.shipping_terms || null; }); } catch (eT) { termsBy = {}; }
  // v55.83-TO (Codex QA 16 Nov, P1) — an EXW invoice that still carries a shipping line means we DID handle shipping: not a waiver
  var exwIds = Object.keys(termsBy).filter(function (k) { return termsBy[k] === 'EXW'; }); var shipLineInv = {};
  if (exwIds.length) { (await inChunks(db, 'accounting_invoice_items', 'invoice_id, description, wave_product_name, quantity, unit_price', 'invoice_id', exwIds)).forEach(function (it) { var amtI = (Number(it.quantity) || 0) * (Number(it.unit_price) || 0); if (amtI > 0 && isTransportLine(it.wave_product_name || it.description)) { shipLineInv[it.invoice_id] = true; } }); }
  var bills = await fetchAll(function () { return db.from('vendor_bills').select('id, bill_number, vendor_name, release_number, bill_type, shipment_direction, record_status, total_amount').in('bill_type', ['shipping', 'trucking']); });
  var bpays = bills.length ? await inChunks(db, 'vendor_bill_payments', 'bill_id, amount, voided', 'bill_id', bills.map(function (b) { return b.id; })) : [];
  var bPaid = {}; bpays.forEach(function (p) { if (p.voided !== true) { bPaid[p.bill_id] = r2((bPaid[p.bill_id] || 0) + (Number(p.amount) || 0)); } });
  var billsByRel = {}; bills.forEach(function (b) { if (b.record_status !== 'active' || (b.shipment_direction && b.shipment_direction !== 'outbound')) { return; } releasesOf(b.release_number).forEach(function (k) { (billsByRel[k] = billsByRel[k] || []).push({ id: b.id, number: b.bill_number, vendor: b.vendor_name, bill_type: b.bill_type, record_status: b.record_status, total: r2(b.total_amount), paid: bPaid[b.id] || 0 }); }); });
  // the order monitor's own tables (need the TI SQL)
  var tablesReady = true; var depHub = {}; var links = {}; var ovr = {};
  try {
    (await fetchAll(function () { return db.from('order_deposit_status').select('*').eq('source', cfg.source); })).forEach(function (d) { depHub[d.order_id] = d; });
    (await fetchAll(function () { return db.from('order_deposit_links').select('*').eq('source', cfg.source).eq('voided', false); })).forEach(function (l) { (links[l.order_id] = links[l.order_id] || []).push(l); });
    (await fetchAll(function () { return db.from('order_monitor_overrides').select('*').eq('source', cfg.source).eq('active', true); })).forEach(function (o) { (ovr[o.order_id] = ovr[o.order_id] || []).push(o); });
  } catch (eM) { if (missingTable(eM.message)) { tablesReady = false; } else { throw eM; } }
  var names = {}; var idSet = {}; Object.keys(ovr).forEach(function (k) { ovr[k].forEach(function (o) { if (o.set_by) { idSet[o.set_by] = true; } }); });
  if (Object.keys(idSet).length) { try { (await inChunks(db, 'users', 'id, name, email', 'id', Object.keys(idSet))).forEach(function (u) { names[u.id] = u.name || u.email; }); } catch (eU) { /* fail-soft */ } }
  var site = String(feed.site || cfg.host || '').replace(/^https?:\/\//, '');
  var out = [];
  (feed.orders || []).forEach(function (o) {
    if (opts && opts.orderId && Number(o.id) !== Number(opts.orderId)) { return; }
    var rk = relKey(o.release_number); var sg = stagesBy[o.id] || {}; var rows = {};
    Object.keys(sg).forEach(function (st) { rows[st] = latestRow(sg[st]); });
    // v55.83-TM — Wave invoices carry the release in their P.O./S.O. field (the Hub pushes it there; Wave imports keep it there), so a
    // P.O./S.O. match COUNTS as linked; it is only noted that Release Number is empty (one click copies it).
    function invObj(i, poOnly) { var p = (paysBy[i.id] || []).reduce(function (t, x) { return t + (Number(x.amount) || 0); }, 0); return { id: i.id, number: i.invoice_number, record_status: i.record_status || 'active', approval_status: i.approval_status, wave_sync_status: i.wave_sync_status, customer_name: custName[i.accounting_customer_id] || null, total: r2(i.total_amount), paid: r2(p + (Number(i.wave_imported_paid) || 0)), date: i.invoice_date, terms: termsBy[i.id] || null, po_so_only: !!poOnly }; }
    var invList = (rk ? (invByRel[rk] || []) : []).map(function (i) { return invObj(i, false); });
    var have = {}; invList.forEach(function (i) { have[i.id] = true; });
    (rk ? (poByRel[rk] || []) : []).forEach(function (i) { if (!have[i.id]) { have[i.id] = true; invList.push(invObj(i, true)); } });
    var liveInv = invList.filter(function (i) { return i.record_status === 'active'; });
    var invPays = []; var imported = 0;
    liveInv.forEach(function (i) { (paysBy[i.id] || []).forEach(function (p) { invPays.push({ bank_transaction_id: p.bank_transaction_id, amount: p.amount }); }); var raw = invs.filter(function (x) { return x.id === i.id; })[0]; imported += Number(raw && raw.wave_imported_paid) || 0; });
    var cur = liveInv.filter(function (i) { return i.approval_status === 'approved'; });
    var exw = cur.length > 0 && cur.every(function (i) { return i.terms === 'EXW' && !shipLineInv[i.id]; }); // TO — confirmed: EXW chosen on the form, no shipping line
    var blockers = [];
    if (rk && mainRelCount[rk] > 1) { blockers.push('this release number is on ' + mainRelCount[rk] + ' warehouse orders'); }
    if (/^\s*test\b/i.test(String(o.customer_name || ''))) { blockers.push('test order on the warehouse copy'); }
    var ovs = (ovr[o.id] || []).map(function (x) { return Object.assign({}, x, { by_name: names[x.set_by] || 'someone' }); });
    var closeOv = ovs.filter(function (x) { return x.kind === 'keep_open' || x.kind === 'force_close'; }).sort(function (a, b) { return String(b.set_at).localeCompare(String(a.set_at)); })[0] || null;
    var ev = evaluateOrder({ order: o, rows: rows, history: histBy[o.id] || [], obsolete: !!(Number(o.is_obs_order_included) === 1 || o.is_obs_order_included === true || (rk && obsRel[rk])),
      invoices: invList, invoicePayments: invPays, importedPaid: imported, depositHub: depHub[o.id] || null, depositLinks: (links[o.id] || []).map(function (l) { return { bank_transaction_id: l.bank_transaction_id, amount: l.amount }; }),
      bills: rk ? (billsByRel[rk] || []) : [], exw: exw, blockers: blockers, closeOverride: closeOv, itemOverrides: ovs.filter(function (x) { return x.kind === 'item_na'; }) }, nowMs);
    ev.links = { nextrade: site ? 'https://' + site + '/admin/orders/edit-order/' + o.id : null, hub: HUB_URL + '/?order=' + o.id };
    ev.bills = rk ? (billsByRel[rk] || []) : []; ev.overrides = ovs; ev.deposit_links = links[o.id] || [];
    out.push(ev);
  });
  return { cfg: cfg, feed: feed, orders: out, tablesReady: tablesReady, generated_at: new Date(nowMs).toISOString() };
}
function rowOf(ev) {
  var o = ev.order;
  return { id: o.id, release_number: o.release_number, customer: o.customer_name, country: o.country, warehouse: o.warehouse_name, stage: ev.stage, stage_label: ev.stage_label,
    scheduled: ev.deadline.scheduled || null, shipped_date: o.shipped_date || null, deadline: { state: ev.deadline.state, hours_left: ev.deadline.hours_left === undefined ? null : Math.round(ev.deadline.hours_left * 10) / 10, short_notice: !!ev.deadline.short_notice },
    readiness: ev.readiness, invoice: { state: ev.invoice.state, words: ev.invoice.words, severe: ev.invoice.severe, numbers: ev.invoice.all.map(function (i) { return i.number; }), flags: ev.invoice.flags || [],
      items: ev.invoice.all.map(function (i) { return { id: i.id, number: i.number, po_so_only: !!i.po_so_only, approval_status: i.approval_status || null, record_status: i.record_status || 'active' }; }) },
    deposit: { status: ev.deposit.status, words: ev.deposit.words, blocked: ev.deposit.blocked }, outstanding: ev.outstanding.map(function (i) { return i.label; }),
    next_action: ev.next_action, closable: ev.closure.eligible, shipped_outstanding: ev.shipped_outstanding, links: ev.links };
}

// ── the 30-hour check: record, send (only when switched on), resolve ──
async function runDeadline(db, kind) {
  var run = await db.from('order_review_runs').insert({ kind: kind }).select('id').single();
  if (run.error) { throw new Error(run.error.message); }
  try {
    var all = await loadAll(db); if (all.error) { throw new Error(all.error); }
    var st = await db.from('order_monitor_settings').select('key, value');
    var set = {}; ((st && st.data) || []).forEach(function (r) { set[r.key] = r.value; });
    var enabled = set.alerts_enabled === true; var to = Array.isArray(set.alert_recipients) && set.alert_recipients.length ? set.alert_recipients : ALERT_RECIPIENTS_DEFAULT;
    var alerting = {}; var sent = 0; var newOnes = 0; var sendErr = 0;
    for (var i = 0; i < all.orders.length; i++) {
      var ev = all.orders[i]; var d = ev.deadline;
      if (!d.alert) { continue; }
      alerting[d.alert_key] = true;
      var up = await db.from('order_alerts').upsert({ source: all.cfg.source, order_id: ev.order.id, alert_key: d.alert_key, kind: d.state, payload: rowOf(ev) }, { onConflict: 'source,alert_key', ignoreDuplicates: true }).select('id');
      if (up.data && up.data.length) { newOnes++; }
      var ex = await db.from('order_alerts').select('id, sent_at, resolved_at').eq('source', all.cfg.source).eq('alert_key', d.alert_key).maybeSingle();
      if (enabled && ex.data && !ex.data.sent_at && !ex.data.resolved_at) {
        // v55.83-TO (Codex QA) — CLAIM the alert first: only the check that sets sending_at sends it; if the claim fails, nobody sends
        var claim = await db.from('order_alerts').update({ sending_at: new Date().toISOString() }).eq('id', ex.data.id).is('sent_at', null).is('sending_at', null).select('id');
        if (claim.error || !claim.data || !claim.data.length) { continue; }
        var em = alertEmail(ev, ev.links.hub + (ev.links.nextrade ? ' · order in Nextrade: ' + ev.links.nextrade : ''));
        var res = await sendAlertEmail(to, em.subject, em.html);
        await db.from('order_alerts').update(res && res.sent ? { sent_at: new Date().toISOString(), recipients: to, send_error: null } : { send_error: (res && res.reason) || 'not sent', sending_at: null }).eq('id', ex.data.id);
        if (res && res.sent) { sent++; } else { sendErr++; }
      }
    }
    // resolve alerts that no longer apply (reached the stage, shipped, rescheduled, cancelled)
    var open = await db.from('order_alerts').select('id, alert_key, order_id').eq('source', all.cfg.source).is('resolved_at', null);
    var byId = {}; all.orders.forEach(function (ev) { byId[ev.order.id] = ev; });
    var resolved = 0;
    for (var j = 0; j < ((open && open.data) || []).length; j++) {
      var a = open.data[j]; if (alerting[a.alert_key]) { continue; }
      var cur = byId[a.order_id]; var why = !cur ? 'the order is no longer in the warehouse list' : (cur.deadline.state === 'reached' || cur.deadline.state === 'reached_late' ? 'reached Shipping In Process' : (cur.deadline.state === 'shipped' ? 'shipped' : (cur.order.status === 'cancelled' ? 'cancelled' : 'rescheduled or no longer applies')));
      await db.from('order_alerts').update({ resolved_at: new Date().toISOString(), resolved_why: why }).eq('id', a.id); resolved++;
    }
    var summary = { orders: all.orders.length, alerting: Object.keys(alerting).length, new_alerts: newOnes, emails_sent: sent, email_failures: sendErr, resolved: resolved, alerts_enabled: enabled, source: all.cfg.source };
    await db.from('order_review_runs').update({ finished_at: new Date().toISOString(), ok: sendErr === 0, summary: summary, error: sendErr ? sendErr + ' alert email(s) failed' : null }).eq('id', run.data.id);
    return { ok: true, summary: summary };
  } catch (e) {
    await db.from('order_review_runs').update({ finished_at: new Date().toISOString(), ok: false, error: (e && e.message) || String(e) }).eq('id', run.data.id);
    return { ok: false, error: (e && e.message) || String(e) };
  }
}

// ── close one order: in Nextrade first (staging unless Max allowed live), then recorded in the Hub ──
async function closeInNextrade(cfg, orderId, reason, byName, mode, requestId, expectedUpdatedAt) {
  try {
    var res = await fetch(cfg.closeUrl, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Hub-Close-Token': cfg.closeToken || '', Accept: 'application/json' }, body: JSON.stringify({ order_id: orderId, reason: reason, closed_by_name: byName, mode: mode, request_id: requestId, source: cfg.source, expected_updated_at: expectedUpdatedAt || null }), cache: 'no-store' });
    var j = await res.json().catch(function () { return null; });
    return { ok: !!(res.ok && j && j.ok), status: res.status, body: j };
  } catch (e) { return { ok: false, status: 0, body: { error: (e && e.message) || 'network' } }; }
}
// v55.83-TO (Codex QA 16 Nov, P1) — durable closure: pending row first (unique request id), then Nextrade, then the outcome. If the
// Hub cannot record the intent, Nextrade is not asked. If it cannot record the outcome, the closure is reported as FAILED.
async function closeTracked(db, cfg, ev, mode, reason, byId, byName, requestId) {
  var o = ev.order;
  if (!cfg.closeToken) { return { ok: false, error: 'Closing in Nextrade is not set up yet (NEXTRADE_CLOSE_TOKEN in Vercel) — nothing was closed.' }; }
  var pend =await db.from('order_closures').insert({ source: cfg.source, order_id: o.id, release_number: o.release_number, mode: mode, reason: reason, closed_by: byId || null, written_to_nextrade: false, status: 'pending', request_id: requestId, open_exceptions: ev.closure.missing || [] }).select('id').single();
  if (pend.error) {
    var prev = await db.from('order_closures').select('id, status, nextrade_response').eq('request_id', requestId).maybeSingle();
    if (!prev.error && prev.data && prev.data.status === 'succeeded') { return { ok: true, repeat: true }; }
    return { ok: false, error: 'The Hub could not record the closure first (' + pend.error.message + ') — Nextrade was not asked. ' + (/status|request_id/.test(pend.error.message) ? 'Run sql/v55-83-TO-payment-guards.sql.' : '') };
  }
  var nx = await closeInNextrade(cfg, o.id, reason, byName, mode, requestId, o.updated_at || null);
  var fin = await db.from('order_closures').update({ status: nx.ok ? 'succeeded' : 'failed', written_to_nextrade: nx.ok, nextrade_response: nx.body }).eq('id', pend.data.id).select('id');
  if (fin.error || !fin.data || !fin.data.length) { return { ok: false, error: 'Nextrade answered ' + (nx.ok ? 'closed' : 'not closed') + ', but the Hub could not record the outcome — check this order.' }; }
  return { ok: nx.ok, error: nx.ok ? null : ((nx.body && nx.body.error) || ('HTTP ' + nx.status)) };
}
async function runNightly(db, kind, byId) {
  var run = await db.from('order_review_runs').insert({ kind: kind }).select('id').single();
  if (run.error) { throw new Error(run.error.message); }
  try {
    var all = await loadAll(db); if (all.error) { throw new Error(all.error); }
    var st = await db.from('order_monitor_settings').select('key, value'); var set = {}; ((st && st.data) || []).forEach(function (r) { set[r.key] = r.value; });
    var autoOn = set.auto_close_enabled === true;
    var s = { orders: all.orders.length, open: 0, shipped_outstanding: 0, missing_invoice: 0, invoice_problems: 0, deposit_blocked: 0, deadline_missed: 0, eligible: 0, closed: [], close_failures: [], held_open: 0, auto_close_enabled: autoOn, source: all.cfg.source };
    for (var i = 0; i < all.orders.length; i++) {
      var ev = all.orders[i]; var o = ev.order;
      if (o.status === 'closed' || o.status === 'cancelled') { continue; }
      s.open++;
      if (ev.shipped_outstanding) { s.shipped_outstanding++; }
      if (ev.invoice.state === 'missing_overdue') { s.missing_invoice++; } else if (ev.invoice.severe || ev.invoice.flags.length) { s.invoice_problems++; }
      if (ev.deposit.blocked && ev.stage_rank < 3) { s.deposit_blocked++; }
      if (ev.deadline.state === 'missed' || ev.deadline.state === 'overdue_unshipped') { s.deadline_missed++; }
      if (ev.closure.held) { s.held_open++; }
      if (!ev.closure.eligible) { continue; }
      s.eligible++;
      if (!autoOn) { continue; }
      var mode = ev.closure.forced ? 'override' : 'auto';
      var reason = ev.closure.forced ? ev.closure.words : 'All applicable requirements met, invoices paid, forwarder and trucker bills paid (overnight review).';
      var nx = await closeTracked(db, all.cfg, ev, mode, reason, byId, 'KTC Hub overnight review', 'nightly:' + run.data.id + ':' + o.id);
      if (nx.ok) { s.closed.push(o.release_number || String(o.id)); } else { s.close_failures.push((o.release_number || o.id) + ': ' + (nx.error || 'failed')); }
    }
    await db.from('order_review_runs').update({ finished_at: new Date().toISOString(), ok: s.close_failures.length === 0, summary: s, error: s.close_failures.length ? s.close_failures.length + ' closure(s) failed' : null }).eq('id', run.data.id);
    return { ok: true, summary: s };
  } catch (e) {
    await db.from('order_review_runs').update({ finished_at: new Date().toISOString(), ok: false, error: (e && e.message) || String(e) }).eq('id', run.data.id);
    return { ok: false, error: (e && e.message) || String(e) };
  }
}

export async function GET(req) {
  var authH = req.headers.get('authorization') || '';
  if (!process.env.CRON_SECRET || authH !== 'Bearer ' + process.env.CRON_SECRET) { return NextResponse.json({ error: 'unauthorized' }, { status: 401 }); }
  var db = admin(); var job = new URL(req.url).searchParams.get('job') || 'deadline';
  try {
    var out = job === 'nightly' ? await runNightly(db, 'nightly', null) : await runDeadline(db, 'deadline');
    return NextResponse.json(Object.assign({ api_build_marker: API_BUILD_MARKER, job: job }, out), { status: out.ok ? 200 : 502 });
  } catch (e) { return NextResponse.json({ ok: false, error: missingTable(e && e.message) ? SQL_HINT : ((e && e.message) || 'failed'), api_build_marker: API_BUILD_MARKER }, { status: 500 }); }
}

export async function POST(req) {
  var db = admin();
  try {
    var body = await req.json().catch(function () { return {}; });
    var action = body.action || (body.event === 'stage_saved' ? 'ping' : 'report'); // Nextrade's ping sends { order_id, event: 'stage_saved' }
    // Nextrade's ping after a stage save: same secret token as the feed; at most one check every 2 minutes
    if (action === 'ping') {
      var tok = String(req.headers.get('x-hub-feed-token') || ''); var cfgP = feedConfig();
      if (cfgP.error || !tok || tok !== cfgP.token) { return bad('unauthorized', 401); }
      var last = await db.from('order_review_runs').select('started_at').eq('kind', 'deadline').order('started_at', { ascending: false }).limit(1);
      if (last.data && last.data.length && Date.now() - Date.parse(last.data[0].started_at) < 120000) { return NextResponse.json({ ok: true, skipped: 'checked less than 2 minutes ago' }); }
      var pr = await runDeadline(db, 'deadline'); return NextResponse.json(Object.assign({ api_build_marker: API_BUILD_MARKER }, pr));
    }
    var who = await verifiedCaller(req, body, createClient);
    if (who.error) { return bad(who.error, who.status); }
    var userId = who.userId;
    var g1 = await assertPermission(db, userId, 'accounting.view', req);
    if (!g1.ok) { return bad('This needs "Accounting Access" (P1) — Settings → 🏦 Banking & Accounting Access.', 403); }
    var gv = await assertPermission(db, userId, 'orders.monitor', req);
    if (!gv.ok) { return bad('This needs the "Orders: Monitor" permission — Settings → Module Access.', 403); }
    var canManage = !!((await assertPermission(db, userId, 'orders.manage', req)) || {}).ok;
    var isSuper = !!(gv.ctx && gv.ctx.isSuperAdmin);

    // v55.83-TM (Max, Nov 17) — warehouse releases since June 2026 with no KTC invoice carrying them, each with the way to fix it
    if (action === 'reconcile') {
      var allR = await loadAll(db); if (allR.error) { return bad(allR.error, 503); }
      var since = /^\d{4}-\d{2}-\d{2}$/.test(String(body.since || '')) ? body.since : '2026-06-01';
      var siteR = String(allR.feed.site || allR.cfg.host || '').replace(/^https?:\/\//, '');
      var ordR = allR.orders.map(function (ev) { var o = ev.order; return { source: 'main', id: o.id, release_number: o.release_number, customer_name: o.customer_name, status: o.status, shipped_date: o.shipped_date, load_date: ev.deadline && ev.deadline.scheduled ? ev.deadline.scheduled : null, created_at: o.created_at, link: ev.links && ev.links.nextrade }; })
        .concat((allR.feed.obsolete_orders || []).map(function (o) { return { source: 'obsolete', id: o.id, release_number: o.release_number, customer_name: o.customer_name, status: o.status, shipped_date: o.shiped_date, load_date: o.load_date, created_at: o.created_at, link: null }; }));
      var invR = await fetchAll(function () { return db.from('accounting_invoices').select('id, invoice_number, release_number, po_so_number, accounting_customer_id, total_amount, record_status, approval_status, invoice_date, notes, source'); });
      var cIds = {}; invR.forEach(function (i) { if (i.accounting_customer_id) { cIds[i.accounting_customer_id] = true; } });
      var cRows = Object.keys(cIds).length ? await inChunks(db, 'accounting_customers', 'id, company_name, contact_name', 'id', Object.keys(cIds)) : [];
      var cName = {}; cRows.forEach(function (c) { cName[c.id] = c.company_name || c.contact_name || null; });
      invR.forEach(function (i) { i.customer_name = cName[i.accounting_customer_id] || null; });
      var recRows = reconcileReleases(ordR, invR, since);
      var canEditInv = !!((await assertPermission(db, userId, 'invoices.edit', req)) || {}).ok;
      return NextResponse.json({ ok: true, rows: recRows, since: since, source: allR.cfg.source, site: siteR || null, orders_checked: ordR.length, can_edit_invoices: canEditInv, generated_at: allR.generated_at, api_build_marker: API_BUILD_MARKER });
    }
    // v55.83-TM — copy a Wave invoice's P.O./S.O. (the release) into its EMPTY Release Number. Never overwrites; never touches Wave
    // (Wave already has the same number as its P.O.). Every copy is in the audit trail.
    if (action === 'copy_release_from_po') {
      var ge = await assertPermission(db, userId, 'invoices.edit', req);
      if (!ge.ok) { return bad('This needs the "Invoices: Edit" permission.', 403); }
      var ids = (Array.isArray(body.invoice_ids) ? body.invoice_ids : [body.invoice_id]).filter(function (x) { return typeof x === 'string' && x.length > 10; }).slice(0, 500);
      if (!ids.length) { return bad('Choose the invoice.'); }
      var src = await inChunks(db, 'accounting_invoices', 'id, invoice_number, release_number, po_so_number, record_status', 'id', ids);
      var done = []; var skipped = [];
      for (var ci = 0; ci < src.length; ci++) {
        var iv = src[ci];
        if (String(iv.release_number || '').trim()) { skipped.push({ number: iv.invoice_number, why: 'already has a release number' }); continue; }
        if (!releasesOf(iv.po_so_number).length) { skipped.push({ number: iv.invoice_number, why: 'its P.O./S.O. does not look like a release number' }); continue; }
        var upI = await db.from('accounting_invoices').update({ release_number: String(iv.po_so_number).trim() }).eq('id', iv.id).or('release_number.is.null,release_number.eq.').select('id');
        if (upI.error) { return bad('Not saved: ' + upI.error.message, 500); }
        if (!upI.data || !upI.data.length) { skipped.push({ number: iv.invoice_number, why: 'changed by someone else meanwhile' }); continue; }
        await audit(db, userId, 'invoice_release_copied_from_po', 'accounting_invoice', iv.id, { invoice: iv.invoice_number, release_number: String(iv.po_so_number).trim(), from: 'P.O./S.O. field' });
        done.push(iv.invoice_number);
      }
      return NextResponse.json({ ok: true, copied: done, skipped: skipped, api_build_marker: API_BUILD_MARKER });
    }
    if (action === 'report') {
      var all = await loadAll(db); if (all.error) { return bad(all.error, 503); }
      var rows = all.orders.filter(function (ev) { return body.include_closed === true || (ev.order.status !== 'closed' && ev.order.status !== 'cancelled'); }).map(rowOf);
      var runs = { deadline: null, nightly: null, last_ok_nightly: null, last_ok_deadline: null }; var settings = {};
      if (all.tablesReady) {
        var rD = await db.from('order_review_runs').select('*').eq('kind', 'deadline').order('started_at', { ascending: false }).limit(1); runs.deadline = rD.data && rD.data[0] || null;
        var rN = await db.from('order_review_runs').select('*').in('kind', ['nightly', 'manual']).order('started_at', { ascending: false }).limit(1); runs.nightly = rN.data && rN.data[0] || null;
        var rNo = await db.from('order_review_runs').select('finished_at').in('kind', ['nightly', 'manual']).eq('ok', true).order('finished_at', { ascending: false }).limit(1); runs.last_ok_nightly = rNo.data && rNo.data[0] ? rNo.data[0].finished_at : null;
        var rDo = await db.from('order_review_runs').select('finished_at').eq('kind', 'deadline').eq('ok', true).order('finished_at', { ascending: false }).limit(1); runs.last_ok_deadline = rDo.data && rDo.data[0] ? rDo.data[0].finished_at : null;
        var sR = await db.from('order_monitor_settings').select('key, value'); ((sR && sR.data) || []).forEach(function (r) { settings[r.key] = r.value; });
      }
      return NextResponse.json({ ok: true, rows: rows, source: all.cfg.source, site: all.feed.site || null, generated_at: all.generated_at, tables_ready: all.tablesReady, sql_hint: all.tablesReady ? null : SQL_HINT, runs: runs, settings: settings, can_manage: canManage, is_super_admin: isSuper, history_in_feed: Array.isArray(all.feed.status_history), api_build_marker: API_BUILD_MARKER });
    }
    if (action === 'order') {
      var one = await loadAll(db, { orderId: body.order_id }); if (one.error) { return bad(one.error, 503); }
      var ev = one.orders[0]; if (!ev) { return bad('That order is not in the warehouse list.', 404); }
      var extra = { alerts: [], closures: [] };
      if (one.tablesReady) {
        var al = await db.from('order_alerts').select('kind, alert_key, first_seen_at, sent_at, recipients, send_error, resolved_at, resolved_why').eq('source', one.cfg.source).eq('order_id', ev.order.id).order('first_seen_at', { ascending: false }).limit(20); extra.alerts = al.data || [];
        var cl = await db.from('order_closures').select('mode, reason, closed_at, written_to_nextrade, open_exceptions').eq('source', one.cfg.source).eq('order_id', ev.order.id).order('closed_at', { ascending: false }).limit(10); extra.closures = cl.data || [];
      }
      return NextResponse.json({ ok: true, report: Object.assign(rowOf(ev), { items: ev.items, invoices: ev.invoice.all, invoice_flags: ev.invoice.flags, deposit: ev.deposit, deadline: ev.deadline, closure: ev.closure, groups: ev.groups, bills: ev.bills, overrides: ev.overrides, deposit_links: ev.deposit_links }), extra: extra, source: one.cfg.source, can_manage: canManage, api_build_marker: API_BUILD_MARKER });
    }
    if (!canManage && ['set_deposit_status', 'link_deposit', 'unlink_deposit', 'override', 'end_override', 'close_order', 'run_now', 'deposit_candidates'].indexOf(action) >= 0) { return bad('This needs the "Orders: Manage" permission — Settings → Module Access.', 403); }
    var cfgM = feedConfig(); if (cfgM.error) { return bad(cfgM.error, 503); }
    var src = cfgM.source; var oid = Number(body.order_id);
    if (action === 'set_deposit_status') {
      var stv = body.status === 'not_required' ? 'not_required' : (body.status === 'required' ? 'required' : null);
      if (!stv || !(oid > 0)) { return bad('Pick the order and the deposit status.'); }
      var note = String(body.note || '').trim();
      if (stv === 'not_required' && note.length < 5) { return bad('Write why no deposit is needed (a short sentence).'); }
      var prevD = await db.from('order_deposit_status').select('status, note').eq('source', src).eq('order_id', oid).maybeSingle();
      var upD = await db.from('order_deposit_status').upsert({ source: src, order_id: oid, status: stv, note: note || null, set_by: userId, set_at: new Date().toISOString() }, { onConflict: 'source,order_id' });
      if (upD.error) { return bad(missingTable(upD.error.message) ? SQL_HINT : upD.error.message, 500); }
      await audit(db, userId, 'order_deposit_status_set', 'warehouse_order', String(oid), { from: prevD.data || null, to: { status: stv, note: note || null }, release: body.release_number || null });
      return NextResponse.json({ ok: true });
    }
    if (action === 'deposit_candidates') {
      // money IN on the US accounts, settled, with what is still free (not matched to invoices and not linked to orders)
      var q = db.from('bank_transactions').select('id, date, posted_date, amount_abs, name, merchant_name, direction, pending, account_id').eq('direction', 'in').neq('pending', true);
      var amt = Number(String(body.amount || '').replace(/[$,\s]/g, '')); if (amt > 0) { q = q.gte('amount_abs', r2(amt - 0.5)).lte('amount_abs', r2(amt + 0.5)); }
      var tq = String(body.q || '').replace(/[%,()]/g, ' ').trim(); if (tq) { q = q.or('name.ilike.%' + tq + '%,merchant_name.ilike.%' + tq + '%'); }
      var lr = await q.order('date', { ascending: false }).limit(100); if (lr.error) { return bad(lr.error.message, 500); }
      var scopeD = await privateScope(db, userId); if (scopeD.error) { return bad(scopeD.error + ' — no bank lines shown.', 503); } // v55.83-TP
      lr.data = dropPrivate(lr.data, scopeD);
      var ids = (lr.data || []).map(function (t) { return t.id; });
      var usedInv = ids.length ? await inChunks(db, 'accounting_invoice_payments', 'bank_transaction_id, amount, voided', 'bank_transaction_id', ids) : [];
      var usedLnk = []; try { usedLnk = ids.length ? await inChunks(db, 'order_deposit_links', 'bank_transaction_id, amount, voided', 'bank_transaction_id', ids) : []; } catch (eL) { usedLnk = []; }
      var u = {}; usedInv.concat(usedLnk).forEach(function (p) { if (p.voided !== true) { u[p.bank_transaction_id] = r2((u[p.bank_transaction_id] || 0) + (Number(p.amount) || 0)); } });
      var linesC = (lr.data || []).map(function (t) { return { id: t.id, date: t.posted_date || t.date, amount: r2(t.amount_abs), used: u[t.id] || 0, free: r2(Math.max(0, r2(t.amount_abs) - (u[t.id] || 0))), name: String(t.merchant_name || t.name || '').substring(0, 60) }; }).filter(function (x) { return x.free > 0.005; });
      return NextResponse.json({ ok: true, lines: linesC });
    }
    if (action === 'link_deposit') {
      var txId = body.bank_transaction_id; var la = r2(body.amount);
      if (!(oid > 0) || !txId || !(la > 0)) { return bad('Pick the order, the bank transaction and the amount.'); }
      var reqL = typeof body.request_id === 'string' && body.request_id.length >= 8 ? body.request_id.substring(0, 80) : null;
      if (reqL) { var dupL = await db.from('order_deposit_links').select('id').eq('request_id', reqL).maybeSingle(); if (dupL.error && !missingTable(dupL.error.message)) { return bad('Could not read earlier matches (' + dupL.error.message + ') — nothing was matched.', 503); } if (dupL.data) { return NextResponse.json({ ok: true, id: dupL.data.id, already_recorded: true }); } }
      var tx = await db.from('bank_transactions').select('id, amount_abs, direction, pending').eq('id', txId).maybeSingle();
      if (tx.error) { return bad('Could not read the bank transaction (' + tx.error.message + ') — nothing was matched.', 503); }
      if (!tx.data) { return bad('Bank transaction not found.', 404); }
      if (tx.data.direction !== 'in') { return bad('A deposit is money IN — that bank transaction is money out.', 409); }
      if (tx.data.pending === true) { return bad('That bank transaction is still pending.', 409); }
      var uI = await db.from('accounting_invoice_payments').select('amount, voided').eq('bank_transaction_id', txId);
      var uL = await db.from('order_deposit_links').select('amount, voided').eq('bank_transaction_id', txId);
      if (uI.error) { return bad('Could not read the invoice payments on that bank line (' + uI.error.message + ') — nothing was matched.', 503); } // TO (Codex P1)
      if (uL.error) { return bad(missingTable(uL.error.message) ? SQL_HINT : uL.error.message, 500); }
      var usedT = 0; ((uI.data || []).concat(uL.data || [])).forEach(function (p) { if (p.voided !== true) { usedT += Number(p.amount) || 0; } });
      if (la > r2(Number(tx.data.amount_abs) - usedT) + 0.005) { return bad('Only $' + r2(Number(tx.data.amount_abs) - usedT).toFixed(2) + ' of this bank transaction is still free.', 409); }
      var insL = await db.from('order_deposit_links').insert({ source: src, order_id: oid, release_number: body.release_number || null, bank_transaction_id: txId, amount: la, note: String(body.note || '').trim() || null, linked_by: userId, request_id: reqL }).select('id').single();
      if (insL.error) { var mL = String(insL.error.message || ''); if (/HUB_GUARD:/.test(mL)) { return bad('Not matched — ' + mL.replace(/^[\s\S]*HUB_GUARD:\s*/, '') + ' Refresh: someone may have just used it.', 409); } return bad(/request_id/.test(mL) ? 'Run sql/v55-83-TO-payment-guards.sql first.' : mL, 500); }
      await audit(db, userId, 'order_deposit_linked', 'warehouse_order', String(oid), { bank_transaction_id: txId, amount: la, release: body.release_number || null, note: body.note || null });
      return NextResponse.json({ ok: true, id: insL.data.id });
    }
    if (action === 'unlink_deposit') {
      var why = String(body.reason || '').trim(); if (why.length < 5) { return bad('Write why this deposit link is undone.'); }
      var ul = await db.from('order_deposit_links').update({ voided: true, voided_by: userId, voided_at: new Date().toISOString(), void_reason: why }).eq('id', body.id).eq('voided', false).select('id, order_id, amount, bank_transaction_id').maybeSingle();
      if (ul.error || !ul.data) { return bad('That link was not found or is already undone.', 404); }
      await audit(db, userId, 'order_deposit_unlinked', 'warehouse_order', String(ul.data.order_id), { bank_transaction_id: ul.data.bank_transaction_id, amount: ul.data.amount, reason: why });
      return NextResponse.json({ ok: true });
    }
    if (action === 'override') {
      var kind = body.kind; var rsn = String(body.reason || '').trim();
      if (['keep_open', 'force_close', 'item_na'].indexOf(kind) < 0 || !(oid > 0)) { return bad('Pick what to override.'); }
      if (rsn.length < 5) { return bad('Write the reason (a short sentence) — it is kept with your name.'); }
      if (kind === 'item_na' && !body.item_key) { return bad('Pick the requirement.'); }
      if (kind !== 'item_na') { await db.from('order_monitor_overrides').update({ active: false, ended_by: userId, ended_at: new Date().toISOString() }).eq('source', src).eq('order_id', oid).in('kind', ['keep_open', 'force_close']).eq('active', true); }
      var io = await db.from('order_monitor_overrides').insert({ source: src, order_id: oid, kind: kind, item_key: body.item_key || null, reason: rsn, set_by: userId }).select('id').single();
      if (io.error) { return bad(missingTable(io.error.message) ? SQL_HINT : io.error.message, 500); }
      await audit(db, userId, 'order_override_set', 'warehouse_order', String(oid), { kind: kind, item: body.item_key || null, reason: rsn, release: body.release_number || null });
      return NextResponse.json({ ok: true });
    }
    if (action === 'end_override') {
      var eo = await db.from('order_monitor_overrides').update({ active: false, ended_by: userId, ended_at: new Date().toISOString() }).eq('id', body.id).eq('active', true).select('order_id, kind').maybeSingle();
      if (eo.error || !eo.data) { return bad('That override was not found or already ended.', 404); }
      await audit(db, userId, 'order_override_ended', 'warehouse_order', String(eo.data.order_id), { kind: eo.data.kind });
      return NextResponse.json({ ok: true });
    }
    if (action === 'close_order') {
      var rc = String(body.reason || '').trim(); if (rc.length < 5) { return bad('Write why the order is being closed.'); }
      var oneC = await loadAll(db, { orderId: oid }); if (oneC.error) { return bad(oneC.error, 503); }
      var evC = oneC.orders[0]; if (!evC) { return bad('That order is not in the warehouse list.', 404); }
      if (evC.order.status === 'closed') { return bad('It is already closed in the warehouse.', 409); }
      var uN = await db.from('users').select('name, email').eq('id', userId).maybeSingle();
      var reqC = typeof body.request_id === 'string' && body.request_id.length >= 8 ? body.request_id.substring(0, 80) : ('manual:' + oid + ':' + Date.now());
      var nxC = await closeTracked(db, oneC.cfg, evC, 'manual', rc, userId, (uN.data && (uN.data.name || uN.data.email)) || 'Hub user', reqC);
      await audit(db, userId, 'order_closed_manually', 'warehouse_order', String(oid), { reason: rc, release: evC.order.release_number, written_to_nextrade: nxC.ok, open_exceptions: (evC.closure.missing || []).length, request_id: reqC });
      if (!nxC.ok) { return bad('Not closed: ' + (nxC.error || 'Nextrade did not close it'), 502); }
      return NextResponse.json({ ok: true, open_exceptions: evC.closure.missing || [] });
    }
    if (action === 'run_now') {
      var rn = body.job === 'deadline' ? await runDeadline(db, 'manual') : await runNightly(db, 'manual', userId);
      return NextResponse.json(Object.assign({ api_build_marker: API_BUILD_MARKER }, rn), { status: rn.ok ? 200 : 502 });
    }
    if (action === 'settings') {
      if (!isSuper) { return bad('Only a super admin can change the alert list or switch alerts / automatic closing on.', 403); }
      var ch = {};
      if (body.alerts_enabled === true || body.alerts_enabled === false) { ch.alerts_enabled = body.alerts_enabled; }
      if (body.auto_close_enabled === true || body.auto_close_enabled === false) { ch.auto_close_enabled = body.auto_close_enabled; }
      if (Array.isArray(body.alert_recipients)) {
        var em = body.alert_recipients.map(function (x) { return String(x || '').trim(); }).filter(Boolean);
        if (!em.length || em.some(function (x) { return !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x); })) { return bad('Check the email addresses — one per line, each like name@ktcus.com.'); }
        ch.alert_recipients = em;
      }
      var ks = Object.keys(ch);
      for (var k = 0; k < ks.length; k++) {
        var us = await db.from('order_monitor_settings').upsert({ key: ks[k], value: ch[ks[k]], updated_by: userId, updated_at: new Date().toISOString() }, { onConflict: 'key' });
        if (us.error) { return bad(missingTable(us.error.message) ? SQL_HINT : us.error.message, 500); }
      }
      await audit(db, userId, 'order_monitor_settings_changed', 'order_monitor_settings', ks.join(','), ch);
      return NextResponse.json({ ok: true, changed: ch });
    }
    return bad('Unknown action "' + action + '".');
  } catch (e) {
    return bad(missingTable(e && e.message) ? SQL_HINT : ((e && e.message) || 'Server error'), 500);
  }
}
