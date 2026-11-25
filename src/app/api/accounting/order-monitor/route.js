// /api/accounting/order-monitor — v55.83-TI (Max, Nov 16 2026). ORDER LIFECYCLE, EXCEPTIONS, DEPOSITS, 30-HOUR ALERT, OVERNIGHT REVIEW.
// Reads the Nextrade warehouse (read-only feed: staging, or live once Max allows it — Max said "yes production" 19 Nov), joins the Hub's invoices / payments / bills by
// RELEASE NUMBER, and applies the rules in lib/order-lifecycle.js.
//   GET  ?job=deadline  — every 15 min (Vercel cron, CRON_SECRET): the 30-hour check + alerts
//   GET  ?job=nightly   — every night 02:30 New York: full review, automatic closure (when switched on), summary
//   POST action=ping    — Nextrade calls this right after a stage is saved (X-Hub-Feed-Token); runs the 30-hour check
//   POST report · order · deposit_candidates · set_deposit_status · link_deposit · unlink_deposit · override · end_override ·
//        close_order · settings · run_now  — signed-in users (verified sign-in token)
//   POST archive_row · unarchive_row — v55.83-UC: "Non issue" / "Corrected" takes a row off the report into the archive (never deleted)
//   POST set_invoice_review — shared invoice review for Orders and No KTC Invoice
// SWC-safe: var + string concatenation only.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { assertPermission } from '../../../../lib/server-permissions';
import { verifiedCaller } from '../../../../lib/verified-caller';
import { audit } from '../../../../lib/audit-server';
import { sendAlertEmail } from '../../../../lib/notify-server';
import { evaluateOrder, releasesOf, alertEmail, stageRank, ALERT_RECIPIENTS_DEFAULT, reconcileReleases } from '../../../../lib/order-lifecycle';
import { relKey, isTransportLine } from '../../../../lib/profitability';
import { privateScope, dropPrivate, isPrivateRow } from '../../../../lib/private-accounts-server'; // v55.83-TP — private bank accounts
import { warehouseFeedConfig, feedIdentityProblem } from '../../../../lib/warehouse-feed-config'; // v55.83-UU — approved warehouse addresses only
import { readFeedBody } from '../../../../lib/warehouse-feed-read'; // v55.83-YA

export const maxDuration = 300; // v55.83-YR (Max, Nov 24): the warehouse sends its list slowly — wait up to 150 s for the WHOLE list instead of 40
var FEED_WAIT_SECONDS = 150; var FEED_WAIT_MS = FEED_WAIT_SECONDS * 1000;
var API_BUILD_MARKER = 'v55.83-UU-order-monitor';
var SQL_HINT = 'Run sql/v55-83-TI-order-monitor.sql in Supabase first.';
var ARCHIVE_SQL_HINT = 'Run sql/v55-83-UC-order-report-archive.sql in Supabase first (the Non issue / Corrected archive).';
var HUB_URL = 'https://nexttrade-hub.vercel.app'; // the Hub's real address (hub.ktcus.com was never connected)
function admin() { return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } }); }
function bad(msg, st) { return NextResponse.json({ ok: false, error: msg, api_build_marker: API_BUILD_MARKER }, { status: st || 400 }); }
function r2(x) { return Math.round((Number(x) || 0) * 100) / 100; }
function missingTable(m) { return /order_(monitor|deposit|alerts|review|closures|report_archive)/.test(String(m || '')) && /does not exist|schema cache|not find/i.test(String(m || '')); }
async function fetchAll(q) { var out = []; for (var from = 0; from < 50000; from += 1000) { var r = await q().range(from, from + 999); if (r.error) { throw new Error(r.error.message); } out = out.concat(r.data || []); if (!r.data || r.data.length < 1000) { break; } } return out; }
async function inChunks(db, table, cols, col, ids) { var out = []; for (var i = 0; i < ids.length; i += 200) { var r = await db.from(table).select(cols).in(col, ids.slice(i, i + 200)); if (r.error) { throw new Error(r.error.message); } out = out.concat(r.data || []); } return out; }

// ── the warehouse feed (same address and token as the shipping-cost sync) ──
function feedConfig() {
  // v55.83-UU (Codex 05:56) — only an approved https warehouse address; anything else is refused before the token is sent
  var base = warehouseFeedConfig(process.env); if (base.error) { return { error: base.error }; }
  var url = base.url; var token = base.token; var host = base.host;
  return { url: url, token: token, host: host, source: base.source, closeUrl: url.replace(/\/shipping\/?$/, '/close-order'), closeToken: String(process.env.NEXTRADE_CLOSE_TOKEN || '').trim() }; // TO — closing has its OWN token (Codex P1), never the read token
}
async function fetchFeed(cfg) {
  var ctl = new AbortController(); var tm = setTimeout(function () { ctl.abort(); }, FEED_WAIT_MS);
  try {
    var res = await fetch(cfg.url + '?shipped_since=2024-01-01', { headers: { 'X-Hub-Feed-Token': cfg.token, Accept: 'application/json' }, signal: ctl.signal, cache: 'no-store', redirect: 'error' }); // UU (Codex 06:13) — a redirect never carries the token elsewhere
    var rd = await readFeedBody(res, ctl, FEED_WAIT_SECONDS); // v55.83-YA — a list cut off by the time limit says so plainly (not "answered 200")
    if (res.ok && rd.error) { throw new Error(rd.error); }
    var j = rd.json || null;
    if (!res.ok || !j || j.ok !== true) { throw new Error('The warehouse feed answered ' + res.status + (j && j.error ? ': ' + j.error : '')); }
    var idp = feedIdentityProblem(j, cfg); if (idp) { throw new Error(idp); } // UU — a feed that does not name its copy is refused
    return j;
  } finally { clearTimeout(tm); }
}
// v55.83-UU (Codex 05:38) — closing an order in the warehouse is allowed on the STAGING copy only, unless Max separately allows it on
// live (NEXTRADE_CLOSE_ALLOW_LIVE=yes). Unknown / any other source = refused. Checked on the server for BOTH the Close now button and
// the overnight automatic closing; the live warehouse also has no close-order route at all.
function closingAllowed(cfg) {
  if (!cfg || cfg.error) { return { ok: false, why: 'the warehouse feed is not set up' }; }
  if (cfg.source === 'nextrade-staging') { return { ok: true }; }
  if (cfg.source === 'nextrade-live' && String(process.env.NEXTRADE_CLOSE_ALLOW_LIVE || '') === 'yes') { return { ok: true }; }
  return { ok: false, why: cfg.source === 'nextrade-live' ? 'closing orders from the Hub is switched off for the LIVE warehouse — close it in Nextrade' : 'unknown warehouse copy' };
}
// v55.83-UU (Codex 05:38) — which checklist fields this warehouse copy does NOT have, as the copy itself states (feed.capabilities).
// No statement from the copy = assume every field exists (stricter: a missing value shows as missing, never as done).
var OPTIONAL_COLUMNS = ['shipping_doc_type', 'order_payment_type', 'load_time_known'];
function untrackedOf(feed) {
  var cap = feed && feed.capabilities; var cols = cap && Array.isArray(cap.requirement_columns) ? cap.requirement_columns : null; var out = {};
  if (!cols || !cols.length) { return out; }
  OPTIONAL_COLUMNS.forEach(function (c) { if (cols.indexOf(c) < 0) { out[c] = true; } });
  return out;
}
function latestRow(rows) { return rows.slice().sort(function (a, b) { return String(a.updated_at || '').localeCompare(String(b.updated_at || '')) || (Number(a.id) - Number(b.id)); }).pop() || null; }

// ── everything, evaluated ──
async function loadAll(db, opts) {
  var cfg = feedConfig(); if (cfg.error) { return { error: cfg.error }; }
  var feed = await fetchFeed(cfg);
  rememberFeed(cfg, feed); // UC — the identity check for archiving reuses this read
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
  var untracked = untrackedOf(feed); // UU
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
      bills: rk ? (billsByRel[rk] || []) : [], exw: exw, blockers: blockers, closeOverride: closeOv, itemOverrides: ovs.filter(function (x) { return x.kind === 'item_na'; }), untracked: untracked }, nowMs);
    ev.links = { nextrade: site ? 'https://' + site + '/admin/orders/edit-order/' + o.id : null, hub: HUB_URL + '/?order=' + o.id };
    ev.bills = rk ? (billsByRel[rk] || []) : []; ev.overrides = ovs; ev.deposit_links = links[o.id] || [];
    ev.invoice_release_linked = releasesOf(o.release_number).some(function (key) {
      return (invByRel[key] || []).some(activeInvoice);
    });
    out.push(ev);
  });
  return { cfg: cfg, feed: feed, orders: out, tablesReady: tablesReady, untracked: Object.keys(untracked), generated_at: new Date(nowMs).toISOString() };
}
// v55.83-UC (Max, Nov 18) — rows marked "Non issue" or "Corrected": the ACTIVE archive entry per order (put back ones are history)
var ARCHIVE_CHOICES = { non_issue: 'Non issue', corrected: 'Corrected' };
async function loadArchive(db, source) {
  var map = {};
  try { (await fetchAll(function () { return db.from('order_report_archive').select('*').eq('source', source).is('restored_at', null); })).forEach(function (a) { map[String(a.order_id)] = a; }); }
  catch (eA) { if (/order_report_archive/.test(String(eA.message || '')) && /does not exist|schema cache|not find/i.test(String(eA.message || ''))) { return { ready: false, map: {} }; } throw eA; }
  return { ready: true, map: map };
}
var INVOICE_REVIEW_CHOICES = ['open', 'corrected', 'invoice_created', 'non_issue'];
function activeInvoice(i) { return (i.record_status || 'active') === 'active'; }
function releaseKey(number) { return releasesOf(number).sort().join(','); }
function reviewKey(section, id, release) { return section + ':' + id + ':' + release; }
function matchingArchive(map, id, number) {
  var a = map[String(id)];
  return a && releaseKey(a.release_number) === releaseKey(number) ? a : null;
}
async function loadInvoiceReviews(db, source) {
  var rows = await fetchAll(function () {
    return db.from('order_invoice_reviews').select('*').eq('source', source).order('section').order('order_id').order('release_key');
  });
  return new Map(rows.map(function (r) { return [reviewKey(r.section, r.order_id, r.release_key), r]; }));
}
function invoiceReview(saved, archived, linked) {
  if (archived) {
    return { choice: archived.choice, completed: true, origin: 'orders_archive', archive_id: archived.id,
      note: archived.note, by: archived.archived_by_name, at: archived.archived_at, linked: linked };
  }
  if (saved) {
    var choice = saved.choice === 'invoice_created' && !linked ? 'open' : saved.choice;
    return { choice: choice, completed: choice !== 'open', origin: 'review', revision: saved.revision,
      note: saved.note, by: saved.reviewed_by_name, at: saved.reviewed_at, linked: linked,
      invoice_unlinked: saved.choice === 'invoice_created' && !linked };
  }
  return { choice: linked ? 'linked' : 'open', completed: linked, linked: linked };
}
function reviewFor(reviews, archives, section, id, release, linked) {
  var saved = reviews.get(reviewKey(section, id, releaseKey(release)));
  return invoiceReview(saved, section === 'main' ? matchingArchive(archives, id, release) : null, linked);
}
// what the row showed when it was archived — kept with the entry (as shown on screen; it is a record, it decides nothing)
function cleanSnapshot(x) {
  x = x && typeof x === 'object' ? x : {}; function t(v, n) { return v === null || v === undefined ? null : String(v).substring(0, n || 200); }
  return { customer: t(x.customer), country: t(x.country, 80), stage: t(x.stage_label, 80), readiness: t(x.readiness, 120), invoice: t(x.invoice, 120), deposit: t(x.deposit, 120),
    shipped_date: t(x.shipped_date, 40), scheduled: t(x.scheduled, 40), next_action: t(x.next_action, 400), outstanding: (Array.isArray(x.outstanding) ? x.outstanding : []).slice(0, 40).map(function (o) { return t(o, 160); }), as_shown_on_screen: true };
}
// v55.83-UC (Codex QA 18 Nov, P2) — before an order is archived its identity is checked against the WAREHOUSE FEED (never the screen):
// the order must exist on this warehouse copy, be open, and carry the release the person saw. A copy of the last feed read (≤ 10 min,
// same copy) is used when it already has the order; otherwise the feed is read again. If the feed cannot be read, nothing is archived.
var FEED_IDS = { at: 0, source: null, byId: null, obsoleteById: null };
function rememberFeed(cfg, feed) {
  function index(orders) {
    var by = {};
    (orders || []).forEach(function (o) { by[String(o.id)] = { id: Number(o.id), release_number: o.release_number || null, status: o.status || null, customer_name: o.customer_name || null, country: o.country || null }; });
    return by;
  }
  FEED_IDS = { at: Date.now(), source: cfg.source, byId: index(feed.orders), obsoleteById: index(feed.obsolete_orders) };
}
async function orderIdentity(cfg, oid, section, expectedRelease) {
  var bucket = section === 'obsolete' ? 'obsoleteById' : 'byId';
  var fresh = FEED_IDS[bucket] && FEED_IDS.source === cfg.source && Date.now() - FEED_IDS.at < 600000;
  var cached = fresh && FEED_IDS[bucket][String(oid)];
  if (cached && (expectedRelease === undefined || releaseKey(cached.release_number) === expectedRelease)) {
    return { order: cached, from: 'feed (cached ' + Math.round((Date.now() - FEED_IDS.at) / 1000) + ' s)' };
  }
  var feed; try { feed = await fetchFeed(cfg); } catch (eF) { return { error: 'Could not read the warehouse to check this order (' + ((eF && eF.message) || 'feed') + ') — nothing was ' + (section ? 'saved.' : 'archived.') }; }
  rememberFeed(cfg, feed);
  return { order: FEED_IDS[bucket][String(oid)] || null, from: 'feed' };
}
function sameArchiveRequest(row, src, oid, choice, note) { return !!row && row.source === src && Number(row.order_id) === Number(oid) && row.choice === choice && String(row.note || '') === String(note || ''); }
function archiveOut(row, extra) { return Object.assign({ ok: true, id: row.id, order_id: row.order_id, release_number: row.release_number, choice: row.choice, note: row.note, archived_at: row.archived_at, by_name: row.archived_by_name || null, restored_at: row.restored_at || null, api_build_marker: API_BUILD_MARKER }, extra || {}); }
function rowOf(ev, reviews, archives) {
  var o = ev.order;
  return { id: o.id, release_number: o.release_number, customer: o.customer_name, country: o.country, warehouse: o.warehouse_name, stage: ev.stage, stage_label: ev.stage_label,
    scheduled: ev.deadline.scheduled || null, shipped_date: o.shipped_date || null, deadline: { state: ev.deadline.state, hours_left: ev.deadline.hours_left === undefined ? null : Math.round(ev.deadline.hours_left * 10) / 10, short_notice: !!ev.deadline.short_notice },
    readiness: ev.readiness, ...(reviews ? { invoice_review: reviewFor(reviews, archives, 'main', o.id, o.release_number, ev.invoice_release_linked) } : {}),
    invoice: { state: ev.invoice.state, words: ev.invoice.words, severe: ev.invoice.severe, numbers: ev.invoice.all.map(function (i) { return i.number; }), flags: ev.invoice.flags || [],
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
    var res = await fetch(cfg.closeUrl, { redirect: 'error', method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Hub-Close-Token': cfg.closeToken || '', Accept: 'application/json' }, body: JSON.stringify({ order_id: orderId, reason: reason, closed_by_name: byName, mode: mode, request_id: requestId, source: cfg.source, expected_updated_at: expectedUpdatedAt || null }), cache: 'no-store' });
    var j = await res.json().catch(function () { return null; });
    return { ok: !!(res.ok && j && j.ok), status: res.status, body: j };
  } catch (e) { return { ok: false, status: 0, body: { error: (e && e.message) || 'network' } }; }
}
// v55.83-TO (Codex QA 16 Nov, P1) — durable closure: pending row first (unique request id), then Nextrade, then the outcome. If the
// Hub cannot record the intent, Nextrade is not asked. If it cannot record the outcome, the closure is reported as FAILED.
async function closeTracked(db, cfg, ev, mode, reason, byId, byName, requestId) {
  var o = ev.order;
  var allowC = closingAllowed(cfg); if (!allowC.ok) { return { ok: false, error: 'Not closed: ' + allowC.why + '.' }; } // UU — before anything is recorded or sent
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
    var closeOk = closingAllowed(all.cfg); // UU — the overnight review never closes when closing is not allowed for this copy
    var autoOn = set.auto_close_enabled === true && closeOk.ok;
    var s = { orders: all.orders.length, open: 0, shipped_outstanding: 0, missing_invoice: 0, invoice_problems: 0, deposit_blocked: 0, deadline_missed: 0, eligible: 0, closed: [], close_failures: [], held_open: 0, auto_close_enabled: autoOn, closing_blocked: closeOk.ok ? null : closeOk.why, source: all.cfg.source };
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
      var recState = await Promise.all([loadArchive(db, allR.cfg.source), loadInvoiceReviews(db, allR.cfg.source)]);
      var recRows = reconcileReleases(ordR, invR, since, { includeLinked: true }).map(function (r) {
        return Object.assign(r, { invoice_review: reviewFor(recState[1], recState[0].map, r.source, r.order_id, r.release_number, r.state === 'linked') });
      });
      var canEditInv = !!((await assertPermission(db, userId, 'invoices.edit', req)) || {}).ok;
      return NextResponse.json({ ok: true, rows: recRows, since: since, source: allR.cfg.source, site: siteR || null, orders_checked: ordR.length, can_edit_invoices: canEditInv, can_manage: canManage, generated_at: allR.generated_at, api_build_marker: API_BUILD_MARKER });
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
      // v55.83-UC — archived rows leave the report (and so its counts); they are listed apart, with the order as it is NOW
      var reportState = await Promise.all([loadArchive(db, all.cfg.source), loadInvoiceReviews(db, all.cfg.source)]);
      var arch = reportState[0]; var evBy = {}; all.orders.forEach(function (ev) { evBy[String(ev.order.id)] = ev; });
      var rowsAll = all.orders.filter(function (ev) { return body.include_closed === true || (ev.order.status !== 'closed' && ev.order.status !== 'cancelled'); }).map(function (ev) { return rowOf(ev, reportState[1], arch.map); });
      var rows = rowsAll.filter(function (r) { return !arch.map[String(r.id)]; });
      var aIds = {}; Object.keys(arch.map).forEach(function (k) { if (arch.map[k].archived_by) { aIds[arch.map[k].archived_by] = true; } });
      var aNames = {}; if (Object.keys(aIds).length) { try { (await inChunks(db, 'users', 'id, name, email', 'id', Object.keys(aIds))).forEach(function (u) { aNames[u.id] = u.name || u.email; }); } catch (eN) { /* fail-soft */ } }
      var archived = Object.keys(arch.map).map(function (k) { var a = arch.map[k]; var evA = evBy[k];
        return { archive: { id: a.id, order_id: a.order_id, release_number: a.release_number, choice: a.choice, choice_words: ARCHIVE_CHOICES[a.choice] || a.choice, note: a.note, archived_at: a.archived_at, by_name: aNames[a.archived_by] || a.archived_by_name || 'someone', snapshot: a.snapshot || {} },
          row: evA ? rowOf(evA, reportState[1], arch.map) : null, warehouse_status: evA ? evA.order.status : null }; })
        .sort(function (a, b) { return String(b.archive.archived_at).localeCompare(String(a.archive.archived_at)); });
      var runs = { deadline: null, nightly: null, last_ok_nightly: null, last_ok_deadline: null }; var settings = {};
      if (all.tablesReady) {
        var rD = await db.from('order_review_runs').select('*').eq('kind', 'deadline').order('started_at', { ascending: false }).limit(1); runs.deadline = rD.data && rD.data[0] || null;
        var rN = await db.from('order_review_runs').select('*').in('kind', ['nightly', 'manual']).order('started_at', { ascending: false }).limit(1); runs.nightly = rN.data && rN.data[0] || null;
        var rNo = await db.from('order_review_runs').select('finished_at').in('kind', ['nightly', 'manual']).eq('ok', true).order('finished_at', { ascending: false }).limit(1); runs.last_ok_nightly = rNo.data && rNo.data[0] ? rNo.data[0].finished_at : null;
        var rDo = await db.from('order_review_runs').select('finished_at').eq('kind', 'deadline').eq('ok', true).order('finished_at', { ascending: false }).limit(1); runs.last_ok_deadline = rDo.data && rDo.data[0] ? rDo.data[0].finished_at : null;
        var sR = await db.from('order_monitor_settings').select('key, value'); ((sR && sR.data) || []).forEach(function (r) { settings[r.key] = r.value; });
      }
      // UU (Max 19 Nov) — decisions recorded against the OTHER warehouse copy are kept, never moved or deleted; the screen says how many
      // UU (Codex 05:56, P1/P2) — SUPER ADMIN ONLY: deposit links can sit on private bank accounts, so the amounts are never shown to
      // anyone else (no banner at all for them). Every row is read (paged); a table that cannot be read is reported as
      // "could not be checked", never as zero.
      var otherCopy = null;
      if (isSuper) {
        otherCopy = { deposit_status: null, deposit_links: null, deposit_links_amount: null, overrides: null, archived: null, unavailable: [], archive_not_installed: false };
        var srcA = all.cfg.source;
        var countOther = async function (key, buildQ, sumCol) {
          try { var rowsO = await fetchAll(buildQ); otherCopy[key] = rowsO.length; if (sumCol) { otherCopy[sumCol] = r2(rowsO.reduce(function (t, l) { return t + (Number(l.amount) || 0); }, 0)); } }
          catch (eO) { if (key === 'archived' && /order_report_archive/.test(String(eO && eO.message)) && /does not exist|schema cache|not find/i.test(String(eO && eO.message))) { otherCopy.archive_not_installed = true; } else { otherCopy.unavailable.push(key); } }
        };
        await countOther('deposit_status', function () { return db.from('order_deposit_status').select('order_id').neq('source', srcA).order('order_id', { ascending: true }); });
        await countOther('deposit_links', function () { return db.from('order_deposit_links').select('id, amount').neq('source', srcA).eq('voided', false).order('id', { ascending: true }); }, 'deposit_links_amount');
        await countOther('overrides', function () { return db.from('order_monitor_overrides').select('id').neq('source', srcA).eq('active', true).order('id', { ascending: true }); });
        await countOther('archived', function () { return db.from('order_report_archive').select('id').neq('source', srcA).is('restored_at', null).order('id', { ascending: true }); });
      }
      var closeA = closingAllowed(all.cfg);
      return NextResponse.json({ ok: true, rows: rows, archived: archived, untracked_fields: all.untracked, closing_allowed: closeA.ok, closing_blocked_why: closeA.ok ? null : closeA.why, other_copy: otherCopy, archive_ready: arch.ready, archive_sql_hint: arch.ready ? null : ARCHIVE_SQL_HINT, source: all.cfg.source, site: all.feed.site || null, generated_at: all.generated_at, tables_ready: all.tablesReady, sql_hint: all.tablesReady ? null : SQL_HINT, runs: runs, settings: settings, can_manage: canManage, is_super_admin: isSuper, history_in_feed: Array.isArray(all.feed.status_history), api_build_marker: API_BUILD_MARKER });
    }
    if (action === 'order') {
      var one = await loadAll(db, { orderId: body.order_id }); if (one.error) { return bad(one.error, 503); }
      var ev = one.orders[0]; if (!ev) { return bad('That order is not in the warehouse list.', 404); }
      var orderState = await Promise.all([loadArchive(db, one.cfg.source), loadInvoiceReviews(db, one.cfg.source)]);
      var extra = { alerts: [], closures: [], archive: [] };
      if (one.tablesReady) {
        var al = await db.from('order_alerts').select('kind, alert_key, first_seen_at, sent_at, recipients, send_error, resolved_at, resolved_why').eq('source', one.cfg.source).eq('order_id', ev.order.id).order('first_seen_at', { ascending: false }).limit(20); extra.alerts = al.data || [];
        try { var ah = await db.from('order_report_archive').select('choice, note, archived_at, archived_by_name, restored_at, restored_by_name, restore_note').eq('source', one.cfg.source).eq('order_id', ev.order.id).order('archived_at', { ascending: false }).limit(20); extra.archive = ah.error ? [] : (ah.data || []); } catch (eAh) { extra.archive = []; } // UC
        var cl = await db.from('order_closures').select('mode, reason, closed_at, written_to_nextrade, open_exceptions').eq('source', one.cfg.source).eq('order_id', ev.order.id).order('closed_at', { ascending: false }).limit(10); extra.closures = cl.data || [];
      }
      var closeO = closingAllowed(one.cfg);
      return NextResponse.json({ ok: true, closing_allowed: closeO.ok, closing_blocked_why: closeO.ok ? null : closeO.why, report: Object.assign(rowOf(ev, orderState[1], orderState[0].map), { items: ev.items, invoices: ev.invoice.all, invoice_flags: ev.invoice.flags, deposit: ev.deposit, deadline: ev.deadline, closure: ev.closure, groups: ev.groups, bills: ev.bills, overrides: ev.overrides, deposit_links: ev.deposit_links }), extra: extra, source: one.cfg.source, can_manage: canManage, api_build_marker: API_BUILD_MARKER });
    }
    if (!canManage && ['set_deposit_status', 'link_deposit', 'unlink_deposit', 'override', 'end_override', 'close_order', 'run_now', 'deposit_candidates', 'archive_row', 'unarchive_row', 'set_invoice_review'].indexOf(action) >= 0) { return bad('This needs the "Orders: Manage" permission — Settings → Module Access.', 403); }
    var cfgM = feedConfig(); if (cfgM.error) { return bad(cfgM.error, 503); }
    var src = cfgM.source; var oid = Number(body.order_id);
    if (action === 'set_invoice_review') {
      var section = body.section; var reviewChoice = body.choice;
      var release = releaseKey(body.release_number);
      var revision = body.revision;
      if (body.source !== src) { return bad('The warehouse copy changed. Refresh before reviewing this invoice.', 409); }
      if (['main', 'obsolete'].indexOf(section) < 0 || !Number.isInteger(oid) || oid < 1 || oid > 2147483647 ||
          release.length > 256 || INVOICE_REVIEW_CHOICES.indexOf(reviewChoice) < 0 ||
          (revision != null && (typeof revision !== 'string' || !/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(revision)))) {
        return bad('Choose an order and a valid invoice review status.');
      }
      var identity = await orderIdentity(cfgM, oid, section, release);
      if (identity.error) { return bad(identity.error, 503); }
      var verified = identity.order;
      if (!verified || verified.status === 'cancelled' || /^\s*test\b/i.test(verified.customer_name || '') || releaseKey(verified.release_number) !== release) {
        return bad('This order or release changed in the warehouse. Refresh before reviewing it.', 409);
      }
      var reviewInputs = await Promise.all([
        section === 'main' ? loadArchive(db, src) : { map: {} },
        release ? fetchAll(function () { return db.from('accounting_invoices').select('release_number, record_status').order('id'); }) : [],
        db.from('users').select('name, email').eq('id', userId).maybeSingle()
      ]);
      if (matchingArchive(reviewInputs[0].map, oid, verified.release_number)) {
        return bad('This order was confirmed in Orders. Put it back from the archive before changing its invoice review.', 409);
      }
      var keys = releasesOf(verified.release_number);
      var linked = reviewInputs[1].some(function (i) {
        return activeInvoice(i) && releasesOf(i.release_number).some(function (key) { return keys.indexOf(key) >= 0; });
      });
      if (reviewChoice === 'invoice_created' && !linked) {
        return bad('Save an active KTC invoice with this Release Number first. Then mark it Invoice created.', 409);
      }
      var by = reviewInputs[2].data;
      var newReview = { source: src, section: section, order_id: oid, release_key: release, choice: reviewChoice,
        note: String(body.note || '').trim().substring(0, 1000) || null, reviewed_by: userId,
        reviewed_by_name: by && (by.name || by.email) || null, reviewed_at: new Date().toISOString(), revision: randomUUID() };
      var reviewTable = db.from('order_invoice_reviews');
      var writeReview = revision
        ? reviewTable.update(newReview).eq('source', src).eq('section', section).eq('order_id', oid).eq('release_key', release).eq('revision', revision)
        : reviewTable.insert(newReview);
      var savedReview = await writeReview.select('*').maybeSingle();
      if (!savedReview.data && (!savedReview.error || savedReview.error.code === '23505')) {
        return bad('Someone already changed this invoice review. Check again to see the latest status.', 409);
      }
      if (savedReview.error) { return bad('The invoice review could not be saved. Try again.', 500); }
      try {
        await audit(db, userId, 'order_invoice_review_set', 'warehouse_order', String(oid), {
          source: src, section: section, release: verified.release_number, choice: reviewChoice, note: newReview.note,
          revision: newReview.revision
        });
      } catch (eAudit) { console.error('Invoice review audit log failed', eAudit); }
      return NextResponse.json({ ok: true, invoice_review: invoiceReview(savedReview.data, null, linked) });
    }
    // v55.83-UC (Max, Nov 18) — "Non issue" / "Corrected": the row leaves the report and goes to the archive. Nothing is deleted;
    // the entry keeps who, when, which choice, the note and what the row showed. One click = one entry (request id).
    if (action === 'archive_row') {
      if (body.source && body.source !== src) { return bad('The warehouse copy changed. Refresh before confirming this order.', 409); }
      var choice = body.choice; if (!Object.prototype.hasOwnProperty.call(ARCHIVE_CHOICES, choice)) { return bad('Pick Non issue or Corrected.'); }
      if (!(oid > 0) || Math.floor(oid) !== oid || oid > 2147483647) { return bad('Pick the order.'); }
      var noteA = String(body.note || '').trim().substring(0, 1000);
      var reqA = typeof body.request_id === 'string' && body.request_id.length >= 8 ? body.request_id.substring(0, 80) : null;
      if (!reqA) { return bad('Missing the click id — refresh the page and try again.'); }
      // UC (Codex QA 18 Nov, P2) — a repeated click id is accepted ONLY for the very same archive (copy, order, choice, note);
      // anything else with that id is refused. The saved entry is what is answered.
      var dupA = await db.from('order_report_archive').select('*').eq('request_id', reqA).maybeSingle();
      if (dupA.error) { return bad(missingTable(dupA.error.message) ? ARCHIVE_SQL_HINT : 'Could not check earlier archive entries (' + dupA.error.message + ') — nothing was archived.', missingTable(dupA.error.message) ? 500 : 503); }
      if (dupA.data) {
        if (!sameArchiveRequest(dupA.data, src, oid, choice, noteA)) { return bad('This click id was already used for a different archive entry — nothing was archived. Refresh and try again.', 409); }
        return NextResponse.json(archiveOut(dupA.data, { already_recorded: true }));
      }
      // UC (Codex QA 18 Nov, P2) — the order must be on THIS warehouse copy, open, with the release the person saw
      var idn = await orderIdentity(cfgM, oid);
      if (idn.error) { return bad(idn.error, 503); }
      if (!idn.order) { return bad('Order ' + oid + ' is not on the warehouse list (' + src + ') — nothing was archived.', 404); }
      if (idn.order.status === 'closed' || idn.order.status === 'cancelled') { return bad('Order ' + oid + ' is ' + idn.order.status + ' in the warehouse, so it is not on the report — nothing was archived. Refresh.', 409); }
      if (String(body.release_number || '').trim() !== String(idn.order.release_number || '').trim()) { return bad('The warehouse now shows release ' + (idn.order.release_number || '(none)') + ' for order ' + oid + ', not ' + (String(body.release_number || '').trim() || '(none)') + ' — nothing was archived. Refresh.', 409); }
      var snapA = cleanSnapshot(body.snapshot);
      snapA.verified = { release_number: idn.order.release_number, customer: idn.order.customer_name, country: idn.order.country, warehouse_status: idn.order.status, checked_against: idn.from, checked_at: new Date().toISOString() };
      var uA = await db.from('users').select('name, email').eq('id', userId).maybeSingle();
      var byA = (uA.data && (uA.data.name || uA.data.email)) || null;
      var insA = await db.from('order_report_archive').insert({ source: src, order_id: oid, release_number: idn.order.release_number || null, choice: choice, note: noteA || null, snapshot: snapA, archived_by: userId, archived_by_name: byA, request_id: reqA }).select('*').single();
      if (insA.error) {
        var mA = String(insA.error.message || '');
        if (missingTable(mA)) { return bad(ARCHIVE_SQL_HINT, 500); }
        if (insA.error.code === '23505' || /one_active|duplicate key|request_id/i.test(mA)) {
          // the same click arriving twice at once, or someone else archived this order meanwhile: read what is saved and compare
          var rr = await db.from('order_report_archive').select('*').eq('request_id', reqA).maybeSingle();
          if (!rr.error && rr.data) { return sameArchiveRequest(rr.data, src, oid, choice, noteA) ? NextResponse.json(archiveOut(rr.data, { already_recorded: true })) : bad('This click id was already used for a different archive entry — nothing was archived. Refresh and try again.', 409); }
          var act0 = await db.from('order_report_archive').select('archived_by_name, archived_at, choice').eq('source', src).eq('order_id', oid).is('restored_at', null).maybeSingle();
          var who0 = act0 && act0.data ? ' (' + (ARCHIVE_CHOICES[act0.data.choice] || act0.data.choice) + ' by ' + (act0.data.archived_by_name || 'someone') + ')' : '';
          return bad('This order is already in the archive' + who0 + ' — nothing new was archived. Refresh.', 409);
        }
        return bad('Not archived: ' + mA, 500);
      }
      var auditWarn = null;
      try { await audit(db, userId, 'order_report_archived', 'warehouse_order', String(oid), { choice: choice, note: noteA || null, release: idn.order.release_number || null, source: src, archive_id: insA.data.id, request_id: reqA }); }
      catch (eAu) { auditWarn = 'Archived, but the audit trail line was not written (' + ((eAu && eAu.message) || 'error') + '). The archive entry itself keeps who and when.'; }
      return NextResponse.json(archiveOut(insA.data, { audit_warning: auditWarn }));
    }
    if (action === 'unarchive_row') {
      if (typeof body.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.id)) { return bad('Pick the archived row.'); }
      if (body.source && body.source !== src) { return bad('The warehouse copy changed. Refresh before putting this order back.', 409); }
      var noteU = String(body.note || '').trim().substring(0, 1000);
      var uU = await db.from('users').select('name, email').eq('id', userId).maybeSingle();
      var upU = await db.from('order_report_archive').update({ restored_at: new Date().toISOString(), restored_by: userId, restored_by_name: (uU.data && (uU.data.name || uU.data.email)) || null, restore_note: noteU || null }).eq('id', body.id).eq('source', src).is('restored_at', null).select('id, order_id, choice, release_number').maybeSingle();
      if (upU.error) { return bad(missingTable(upU.error.message) ? ARCHIVE_SQL_HINT : 'Not put back: ' + upU.error.message, 500); }
      if (!upU.data) { return bad('That row is not in the archive any more (already put back?). Refresh.', 404); }
      var auditWarnU = null;
      try { await audit(db, userId, 'order_report_unarchived', 'warehouse_order', String(upU.data.order_id), { was: upU.data.choice, note: noteU || null, release: upU.data.release_number || null, source: src, archive_id: upU.data.id }); }
      catch (eAu2) { auditWarnU = 'Put back, but the audit trail line was not written (' + ((eAu2 && eAu2.message) || 'error') + '). The archive entry itself keeps who and when.'; }
      return NextResponse.json({ ok: true, order_id: upU.data.order_id, audit_warning: auditWarnU });
    }
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
