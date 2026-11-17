// v55.83-TI — ORDER LIFECYCLE, REQUIREMENTS, EXCEPTIONS (Max, Nov 16 2026; proposal approved with his six answers):
//   1 checklist entry stays in Nextrade · 2 scheduled shipping = Load Date (with its time) · 3 ACID / CargoX for Egypt or Kenya
//   (country only, no port) · 4 deposits may be matched straight to an order (proforma deposits) · 5 30-hour alert to
//   support@ / hsaad@ / Jasmine@ktcus.com · 6 the Hub's closure also closes the order in Nextrade.
// Pure rules, no database, no clock (now is passed in). SWC-safe (var + concat).
//
// Inputs come from the Nextrade feed (order, its stage rows, its stage history) and from the Hub (invoices on the release,
// payments, deposit status / links, outbound bills and their payments, overrides).
import { relKey } from './profitability';

export var STAGES = ['pending', 'preload', 'shipping_in_process', 'shipped', 'post_loading_documentation', 'end_stage', 'closed'];
export var STAGE_LABEL = { pending: 'Order created', preload: 'Pre-load Ready', shipping_in_process: 'Shipping In Process', shipped: 'Shipped',
  post_loading_documentation: 'Post-loading docs', end_stage: 'End stage', closed: 'Closed', cancelled: 'Cancelled' };
export function stageRank(st) { var i = STAGES.indexOf(st); return i < 0 ? -1 : i; }
var R_SIP = 2; var R_SHIPPED = 3; var R_POST = 4; var R_END = 5; var R_CLOSED = 6;
export var DEADLINE_HOURS = 30; export var DUE_SOON_HOURS = 24;
export var ALERT_RECIPIENTS_DEFAULT = ['support@ktcus.com', 'hsaad@ktcus.com', 'Jasmine@ktcus.com'];

function txt(v) { return v === null || v === undefined ? '' : String(v).trim(); }
function lc(v) { return txt(v).toLowerCase(); }
function r2(x) { return Math.round((Number(x) || 0) * 100) / 100; }
function has(v) { var t = txt(v); return t !== '' && t !== '0' && t !== '0000-00-00' && !/^0000-00-00/.test(t); }

// ── destination: Egypt or Kenya (Max: "no port necessary.. just Kenya or Egypt") ──
export function acidCountry(country) {
  var c = lc(country);
  if (!c) { return 'unknown'; }
  return c === 'egypt' || c === 'kenya' ? 'yes' : 'no';
}

// ── New York local "2026-11-18 09:00:00" → UTC milliseconds (the business timezone; DST-safe) ──
export function nyLocalToUtcMs(local) {
  var m = String(local || '').match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (!m) { return null; }
  var asUtc = Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
  function offsetAt(ms) {
    var f = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    var p = {}; f.formatToParts(new Date(ms)).forEach(function (x) { p[x.type] = x.value; });
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - ms;
  }
  var guess = asUtc - offsetAt(asUtc);
  return asUtc - offsetAt(guess);
}
export function hasTime(local) { return /[ T]\d{2}:\d{2}/.test(String(local || '')) && !/[ T]00:00(:00)?$/.test(String(local || '')); }

// ── one checklist value → done / missing / na ──
// select values: yes · no · na ("" = not answered). booking_completed also allows "customer"; final_payment paid / bank_doc.
function selDone(v, okValues) { var x = lc(v); if (x === 'na' || x === 'n/a') { return 'na'; } if ((okValues || ['yes']).indexOf(x) >= 0) { return 'done'; } return 'missing'; }
function fieldDone(v) { return has(v) ? 'done' : 'missing'; }

// ── the checklist for one order. Returns items: { stage, key, label, applies: true|false, status: done|missing|na|waiting, why } ──
// ctx = { order, rows: { stage: row }, obsolete (bool), invoice (result of invoiceState), deposit (result of depositState) }
export function requirementItems(ctx) {
  var o = ctx.order || {}; var rows = ctx.rows || {}; var pre = rows.preload || {}; var sip = rows.shipping_in_process || {};
  var shp = rows.shipped || {}; var post = rows.post_loading_documentation || {}; var end = rows.end_stage || {};
  var acid = acidCountry(o.country); var docType = lc(sip.shipping_doc_type); var payType = lc(sip.order_payment_type);
  var items = [];
  function add(stage, key, label, applies, status, why) { items.push({ stage: stage, key: key, label: label, applies: applies, status: applies ? status : 'na', why: why || null }); }
  // Pre-load
  var dep = ctx.deposit || {};
  add('preload', 'deposit', 'Deposit', dep.status !== 'not_required' || !dep.note, dep.status === 'received' || (dep.status === 'not_required' && !!dep.note) ? 'done' : 'missing', dep.words || null);
  // Shipping In Process
  add('shipping_in_process', 'shipping_doc_type', 'Shipping document type (Original BL / SWB)', true, docType === 'original_bl' || docType === 'swb' ? 'done' : 'missing', 'controls “BL Received”');
  add('shipping_in_process', 'order_payment_type', 'Order / payment type (CAD / Non-bank)', true, payType === 'cad' || payType === 'non_bank' ? 'done' : 'missing', 'controls “Final Documents to Bank”');
  add('shipping_in_process', 'freight_forwarder', 'Freight Forwarder', true, fieldDone(sip.freight_forwarder));
  add('shipping_in_process', 'best_rate_received', 'Best Rate Received', true, fieldDone(sip.best_rate_received));
  add('shipping_in_process', 'shipping_line', 'Shipping Line', true, fieldDone(sip.shipping_line));
  add('shipping_in_process', 'booking_completed', 'Booking Completed', true, selDone(sip.booking_completed, ['yes', 'customer']));
  add('shipping_in_process', 'booking_number', 'Booking Number', true, fieldDone(sip.booking_number));
  add('shipping_in_process', 'erd', 'ERD', true, fieldDone(sip.erd));
  add('shipping_in_process', 'sailing_date', 'Sailing Date', true, fieldDone(sip.sailing_date));
  add('shipping_in_process', 'load_date', 'Load date and time (scheduled shipping)', true, has(sip.load_date) ? (hasTime(sip.load_date) ? 'done' : 'missing') : 'missing', has(sip.load_date) && !hasTime(sip.load_date) ? 'the time is missing' : null);
  add('shipping_in_process', 'truker_name', 'Trucker Name', true, fieldDone(sip.truker_name));
  add('shipping_in_process', 'trucker_quote', 'Trucker Quote', true, fieldDone(sip.trucker_quote));
  add('shipping_in_process', 'release_notes', 'Release Notes Submitted', true, selDone(sip.release_notes));
  add('shipping_in_process', 'arrival_date', 'Arrival Date', true, fieldDone(sip.arrival_date));
  add('shipping_in_process', 'america_reference', 'America Reference Number', true, fieldDone(sip.america_reference));
  var acidWhy = acid === 'yes' ? 'applies: destination is ' + txt(o.country) : (acid === 'unknown' ? 'destination country missing' : null);
  add('shipping_in_process', 'acid_received', 'ACID Received', acid !== 'no', acid === 'unknown' ? 'missing' : selDone(sip.acid_received), acidWhy);
  add('shipping_in_process', 'acid_number', 'ACID Number', acid !== 'no', acid === 'unknown' ? 'missing' : fieldDone(sip.acid_number), acidWhy);
  // Shipped (unchanged)
  add('shipped', 'item_shipped_scanned_out', 'Items Shipped and Scanned Out', true, selDone(shp.item_shipped_scanned_out));
  add('shipped', 'shipped_date', 'Shipped Date', true, fieldDone(o.shipped_date));
  // Post-loading documentation
  var preDocs = has(post.pre_shipping_docs) ? post.pre_shipping_docs : sip.pre_shipping_docs; // moved here; the old value still counts
  add('post_loading_documentation', 'pre_shipping_docs', 'Pre-Shipping Docs Customer Approved', true, selDone(preDocs), has(post.pre_shipping_docs) ? null : (has(sip.pre_shipping_docs) ? 'value kept from Shipping In Process' : null));
  add('post_loading_documentation', 'final_doc_submitted_to_ff', 'Final Docs Submitted to FF', true, selDone(post.final_doc_submitted_to_ff));
  add('post_loading_documentation', 'ktc_report_sent', 'KTC Report Sent', true, selDone(post.ktc_report_sent));
  add('post_loading_documentation', 'customer_email_all_paper_work', 'Customer Email and all paperwork completed', true, selDone(post.customer_email_all_paper_work));
  var inv = ctx.invoice || {};
  add('post_loading_documentation', 'ktc_invoice_created', 'KTC Invoice Created', true, inv.state === 'current' ? 'done' : 'missing', 'checked from the Hub invoice');
  add('post_loading_documentation', 'obsolete_report', 'Obsolete Report Updated', !!ctx.obsolete, selDone(post.obelete_report_updated), ctx.obsolete ? 'applies: obsolete goods on this order' : 'no obsolete goods on this order');
  // End stage
  add('end_stage', 'final_bl_draft_to_customer', 'Final BL Draft submitted to customer and approved', true, selDone(end.final_bl_draft_to_customer));
  add('end_stage', 'release_requested', 'Release requested', true, selDone(end.release_requested));
  add('end_stage', 'bl_received', 'BL Received', docType !== 'swb', docType ? selDone(end.bl_received) : 'missing', docType === 'original_bl' ? 'applies: Original BL' : (docType === 'swb' ? 'SWB' : 'depends on the document type (not set)'));
  add('end_stage', 'final_document_to_bank', 'Final Documents submitted to bank', payType !== 'non_bank', payType ? selDone(end.final_document_to_bank) : 'missing', payType === 'cad' ? 'applies: CAD' : (payType === 'non_bank' ? 'Non-bank Order' : 'depends on the payment type (not set)'));
  add('end_stage', 'final_document_to_customer', 'Final Documents submitted to customer', true, selDone(end.final_document_to_customer));
  add('end_stage', 'final_document_to_cargox', 'Final Documents submitted to CargoX', acid !== 'no', acid === 'unknown' ? 'missing' : selDone(end.final_document_to_cargox), acid === 'yes' ? 'applies: ' + txt(o.country) : (acid === 'unknown' ? 'destination country missing' : null));
  add('end_stage', 'final_payment', 'Final Payment', true, selDone(end.final_payment, ['paid', 'bank_doc']));
  // a stage the order has not reached yet: its unanswered items are "waiting", not missing
  var rank = stageRank(o.status);
  items.forEach(function (it) {
    if (it.status === 'missing' && stageRank(it.stage) > rank && !(it.stage === 'preload' && it.key === 'deposit')) { it.status = 'waiting'; }
  });
  return items;
}

// ── invoice: is there a CURRENT KTC invoice for this order? (age never matters) ──
// invoices = [{ id, number, release_number, po_so_only (bool), record_status, approval_status, wave_sync_status, customer_name, total, paid }]
export function invoiceState(order, invoices) {
  var rank = stageRank((order || {}).status);
  // v55.83-TM (Max, Nov 17: 'what does wrongly linked mean') — a release found only in an invoice's P.O./S.O. field is how Wave invoices
  // carry it, so it COUNTS as linked. It is noted (Release Number empty) with a one-click copy; it is never called 'wrongly linked'.
  var byRel = (invoices || []).slice();
  var live = byRel.filter(function (i) { return (i.record_status || 'active') === 'active'; });
  var current = live.filter(function (i) { return i.approval_status === 'approved'; });
  var review = live.filter(function (i) { return i.approval_status === 'internal_review'; });
  var draft = live.filter(function (i) { return !i.approval_status || i.approval_status === 'draft'; });
  var gone = byRel.filter(function (i) { return ['void', 'cancelled', 'archived', 'deleted'].indexOf(i.record_status) >= 0; });
  var poOnly = (invoices || []).filter(function (i) { return i.po_so_only; });
  var flags = [];
  poOnly.filter(function (i) { return (i.record_status || 'active') === 'active'; }).forEach(function (i) { flags.push('Invoice ' + i.number + ' has this release in its P.O./S.O. field (as Wave invoices do) — its Release Number is empty'); });
  // v55.83-TO (Codex QA 16 Nov, P1) — these two exceptions BLOCK automatic closure (only a person's 'close anyway' passes them)
  var blocking = [];
  current.forEach(function (i) { if (i.wave_sync_status === 'pending_sync' || i.wave_sync_status === 'failed') { var w0 = 'Invoice ' + i.number + ' was reopened/changed and is not re-sent to Wave'; flags.push(w0); blocking.push(w0); } });
  live.forEach(function (i) { if (i.customer_name && order && order.customer_name && !sameCustomer(i.customer_name, order.customer_name)) { var w1 = 'Invoice ' + i.number + ' is for ' + i.customer_name + ', the order is for ' + order.customer_name; flags.push(w1); blocking.push(w1); } });
  var state; var words;
  if (current.length) { state = 'current'; words = current.map(function (i) { return i.number; }).join(', ') + (current.length > 1 ? ' (several invoices — partial shipments or a split)' : ''); }
  else if (review.length) { state = 'in_approval'; words = review.map(function (i) { return i.number; }).join(', ') + ' — in approval'; }
  else if (draft.length) { state = 'draft_only'; words = draft.map(function (i) { return i.number; }).join(', ') + ' — draft only, not issued'; }
  else if (gone.length) { state = 'cancelled_only'; words = 'only cancelled / void invoices: ' + gone.map(function (i) { return i.number; }).join(', '); }
  else { state = rank >= R_SHIPPED ? 'missing_overdue' : 'awaiting'; words = rank >= R_SHIPPED ? 'No KTC invoice on this release — overdue (shipped)' : 'Awaiting invoice (not shipped yet)'; }
  var severe = state === 'missing_overdue' || ((state === 'cancelled_only' || state === 'draft_only') && rank >= R_SHIPPED);
  return { state: state, words: words, current: current, all: byRel, review_only: poOnly, cancelled: gone, flags: flags, blocking_flags: blocking, severe: severe };
}
export function sameCustomer(a, b) {
  function core(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\b(inc|llc|ltd|limited|co|corp|company|the|sa|sarl)\b/g, ' ').replace(/\s+/g, ' ').trim(); }
  var x = core(a); var y = core(b); if (!x || !y) { return true; }
  if (x === y || x.indexOf(y) >= 0 || y.indexOf(x) >= 0) { return true; }
  var w = {}; y.split(' ').forEach(function (t) { if (t.length >= 4) { w[t] = true; } });
  return x.split(' ').some(function (t) { return t.length >= 4 && w[t]; });
}

// ── deposit ──
// pre = Nextrade Pre-load row (deposit_received yes/no/na, deposit_amount) · hub = { status: 'not_required'|'required'|null, note }
// invoicePayments = [{ bank_transaction_id, amount }] matched to this order's CURRENT/IN-APPROVAL invoices (non-voided)
// links = [{ bank_transaction_id, amount }] payments matched straight to this order (proforma deposits), non-voided
// A bank transaction is counted ONCE (the larger of its two uses). Unmatched customer money never counts.
export function depositState(pre, hub, invoicePayments, links, importedPaid) {
  var h = hub || {}; var p = pre || {};
  if (h.status === 'not_required') { return { status: 'not_required', note: h.note || null, required: 0, matched: 0, blocked: false, words: h.note ? 'Not required — ' + h.note : 'Not required — a note is needed', complete: !!h.note }; }
  var required = r2(Number(String(p.deposit_amount || '').replace(/[$,\s]/g, '')) || 0);
  var byTx = {}; var loose = 0;
  function addTo(src, kind) { (src || []).forEach(function (x) { var a = r2(x.amount); if (!(a > 0)) { return; } if (x.bank_transaction_id) { var o = byTx[x.bank_transaction_id] || (byTx[x.bank_transaction_id] = { inv: 0, link: 0 }); o[kind] = r2(o[kind] + a); } else { loose = r2(loose + a); } }); }
  addTo(invoicePayments, 'inv'); addTo(links, 'link');
  var matched = loose + r2(Number(importedPaid) || 0);
  Object.keys(byTx).forEach(function (k) { matched = r2(matched + Math.max(byTx[k].inv, byTx[k].link)); });
  var ntx = lc(p.deposit_received);
  if (!(required > 0)) {
    if (ntx === 'na' && h.status !== 'required') { return { status: 'not_required', note: null, required: 0, matched: matched, blocked: false, words: 'Marked N/A in Nextrade — write in the Hub why no deposit is needed', complete: false }; }
    return { status: 'unknown', required: null, matched: matched, blocked: false, words: 'Deposit amount not set in Nextrade (Pre-load)', complete: false };
  }
  if (matched + 0.005 >= required) { return { status: 'received', required: required, matched: matched, blocked: false, words: '$' + matched.toFixed(2) + ' of $' + required.toFixed(2) + ' matched to this order', complete: true }; }
  if (matched > 0) { return { status: 'partial', required: required, matched: matched, blocked: true, words: 'Partly received: $' + matched.toFixed(2) + ' of $' + required.toFixed(2) + ' — shipping blocked', complete: false }; }
  return { status: 'not_received', required: required, matched: 0, blocked: true, words: 'Waiting for deposit — shipping blocked ($' + required.toFixed(2) + ')', complete: false };
}

// ── the 30-hour deadline ──
// sip = Shipping In Process row · history = [{ changed_to, created_at }] (New York local times as stored) · nowMs = Date.now()
export function deadlineState(order, sip, history, nowMs) {
  var o = order || {}; var rank = stageRank(o.status);
  if (o.status === 'cancelled' || rank === R_CLOSED) { return { state: 'not_applicable' }; }
  var sched = sip && has(sip.load_date) ? String(sip.load_date) : null;
  if (rank >= R_SHIPPED) { return { state: 'shipped', scheduled: sched }; }
  if (!sched) { return { state: 'no_schedule', words: 'No load date and time yet — the 30-hour rule cannot be checked' }; }
  // v55.83-TO (Codex QA 16 Nov) — a load date saved before times were kept reads as midnight; Nextrade now says whether the time is
  // real (load_time_known). Unknown time = no timed deadline (never a made-up midnight alert).
  if (sip && sip.load_time_known !== undefined && sip.load_time_known !== null && Number(sip.load_time_known) !== 1) { return { state: 'no_schedule', scheduled: sched, words: 'Load date ' + sched.substring(0, 10) + ' has no confirmed time — set the load time in Nextrade for the 30-hour rule' }; }
  var schedMs = nyLocalToUtcMs(sched); var deadMs = schedMs - DEADLINE_HOURS * 3600000;
  var reached = null;
  (history || []).forEach(function (h) { if (stageRank(h.changed_to) >= R_SIP) { var t = nyLocalToUtcMs(h.created_at); if (t !== null && (reached === null || t < reached)) { reached = t; } } });
  var setMs = sip && sip.updated_at ? nyLocalToUtcMs(sip.updated_at) : null;
  var shortNotice = setMs !== null && setMs > deadMs;
  var base = { scheduled: sched, scheduled_ms: schedMs, deadline_ms: deadMs, short_notice: shortNotice, alert_key: String(o.id) + '|' + sched };
  if (rank >= R_SIP) { return Object.assign(base, { state: reached !== null && reached > deadMs ? 'reached_late' : 'reached', reached_ms: reached }); }
  var hoursLeft = (deadMs - nowMs) / 3600000;
  if (nowMs >= schedMs) { return Object.assign(base, { state: 'overdue_unshipped', hours_left: hoursLeft, alert: true }); }
  // booked with less than 30 hours' notice: the deadline was already behind us when it was booked — its own state, alerted at once
  if (shortNotice) { return Object.assign(base, { state: 'short_notice', hours_left: hoursLeft, alert: true }); }
  if (nowMs >= deadMs) { return Object.assign(base, { state: 'missed', hours_left: hoursLeft, alert: true }); }
  if (hoursLeft <= DUE_SOON_HOURS) { return Object.assign(base, { state: 'due_soon', hours_left: hoursLeft }); }
  return Object.assign(base, { state: 'on_track', hours_left: hoursLeft });
}

// ── automatic closure: every condition must hold (Max approved; a wire marked "sent" is NOT a paid bill) ──
// bills = [{ bill_type, record_status, total, paid }] outbound bills on the release · exw = no shipping by us (all invoices EXW, no shipping line)
export function closureCheck(order, items, invoice, bills, exw, blockers, override) {
  var o = order || {}; var miss = [];
  if (o.status === 'closed') { return { eligible: false, already: true, missing: [] }; }
  if (o.status === 'cancelled') { return { eligible: false, missing: ['the order is cancelled'] }; }
  if (stageRank(o.status) < R_SHIPPED) { miss.push('not shipped yet'); }
  (items || []).forEach(function (it) { if (it.applies && it.status !== 'done' && it.status !== 'na' && stageRank(it.stage) <= R_END) { miss.push(STAGE_LABEL[it.stage] + ': ' + it.label); } });
  var inv = invoice || {};
  if (inv.state !== 'current') { miss.push('no current KTC invoice'); }
  else { inv.current.forEach(function (i) { if (r2(i.total) - r2(i.paid) > 0.005) { miss.push('invoice ' + i.number + ' not fully paid ($' + r2(r2(i.total) - r2(i.paid)).toFixed(2) + ' open)'); } }); }
  (inv.blocking_flags || []).forEach(function (f) { miss.push(f); }); // v55.83-TO (Codex P1)
  // v55.83-TO (Codex QA 16 Nov, P1) — EXW never waives a KNOWN bill: every forwarder / trucker bill on the release must be paid.
  // Only a MISSING bill is excused, and only when it is confirmed that we handled no shipping (`exw` = confirmed, see the route).
  ['shipping', 'trucking'].forEach(function (t) {
    var bl = (bills || []).filter(function (b) { return b.bill_type === t && (b.record_status || 'active') === 'active'; });
    var word = t === 'shipping' ? 'forwarder (freight) bill' : 'trucker bill';
    if (!bl.length) { if (!exw) { miss.push('no ' + word + ' on this release'); } return; }
    bl.forEach(function (b) { if (r2(b.total) - r2(b.paid) > 0.005) { miss.push(word + ' ' + (b.number || '') + ' not paid by a posted payment'); } });
  });
  (blockers || []).forEach(function (b) { miss.push(b); });
  var ov = override || {};
  if (ov.kind === 'keep_open') { return { eligible: false, held: true, missing: miss, words: 'Kept open by ' + (ov.by_name || 'a person') + ': ' + (ov.reason || '') }; }
  if (ov.kind === 'force_close') { return { eligible: true, forced: true, missing: miss, words: 'Closing approved by ' + (ov.by_name || 'a person') + ': ' + (ov.reason || '') }; }
  return { eligible: miss.length === 0, missing: miss };
}

// ── one order, everything: the report row and the per-order report ──
export function evaluateOrder(input, nowMs) {
  var x = input || {}; var o = x.order || {}; var rows = x.rows || {};
  var invoice = invoiceState(o, x.invoices || []);
  var deposit = depositState(rows.preload, x.depositHub, x.invoicePayments, x.depositLinks, x.importedPaid);
  var items = requirementItems({ order: o, rows: rows, obsolete: !!x.obsolete, invoice: invoice, deposit: deposit });
  // Not Applicable chosen by a person on one item (override 'item_na') counts as N/A, with the reason kept
  (x.itemOverrides || []).forEach(function (ov) { items.forEach(function (it) { if (it.key === ov.item_key && it.status !== 'done') { it.status = 'na'; it.applies = false; it.why = 'set N/A by ' + (ov.by_name || 'a person') + ': ' + (ov.reason || ''); } }); });
  var deadline = deadlineState(o, rows.shipping_in_process, x.history, nowMs);
  var rank = stageRank(o.status);
  function group(stages) { var g = items.filter(function (it) { return stages.indexOf(it.stage) >= 0 && it.applies; }); var d = g.filter(function (it) { return it.status === 'done'; }).length; return { done: d, total: g.length, na: items.filter(function (it) { return stages.indexOf(it.stage) >= 0 && !it.applies; }).length }; }
  var outstanding = items.filter(function (it) { return it.applies && it.status === 'missing'; });
  var shippedOutstanding = rank >= R_SHIPPED && rank < R_CLOSED && (outstanding.length > 0 || invoice.severe);
  var blockers = (x.blockers || []).slice();
  var closure = closureCheck(o, items, invoice, x.bills, !!x.exw, blockers, x.closeOverride);
  // readiness label (kept apart from the stage)
  var readiness;
  if (o.status === 'closed') { readiness = { key: 'done', words: 'Closed' }; }
  else if (o.status === 'cancelled') { readiness = { key: 'na', words: 'Cancelled' }; }
  else if (deposit.blocked && rank < R_SHIPPED) { readiness = { key: 'blocked', words: 'Blocked — deposit' }; }
  else if (deadline.state === 'missed' || deadline.state === 'overdue_unshipped') { readiness = { key: 'blocked', words: deadline.state === 'missed' ? '30-hour deadline missed' : 'Scheduled time passed — not shipped' }; }
  else if (shippedOutstanding) { readiness = { key: 'wait', words: 'Shipped — outstanding requirements' }; }
  else if (closure.eligible) { readiness = { key: 'done', words: 'Ready to close' }; }
  else if (outstanding.length) { readiness = { key: 'wait', words: outstanding.length + ' requirement' + (outstanding.length === 1 ? '' : 's') + ' outstanding' }; }
  else { readiness = { key: 'prog', words: 'On track' }; }
  return { order: o, stage: o.status, stage_label: STAGE_LABEL[o.status] || o.status, stage_rank: rank, items: items, outstanding: outstanding,
    invoice: invoice, deposit: deposit, deadline: deadline, closure: closure, readiness: readiness, shipped_outstanding: shippedOutstanding,
    groups: { shipping: group(['preload', 'shipping_in_process']), documents: group(['post_loading_documentation', 'end_stage']) },
    next_action: nextAction(o, deposit, deadline, invoice, outstanding, closure) };
}
function nextAction(o, deposit, deadline, invoice, outstanding, closure) {
  var rank = stageRank(o.status);
  if (o.status === 'closed' || o.status === 'cancelled') { return null; }
  if (deposit.blocked && rank < R_SHIPPED) { return deposit.status === 'partial' ? 'Collect / match the rest of the deposit' : 'Collect the deposit and match it to this order (or its invoice)'; }
  if (deposit.status === 'unknown') { return 'Enter the deposit amount in Nextrade (Pre-load), or mark it not required in the Hub with a note'; }
  if (deadline.state === 'no_schedule' && rank < R_SHIPPED) { return 'Enter the load date and time in Shipping In Process'; }
  if ((deadline.state === 'missed' || deadline.state === 'due_soon' || deadline.state === 'short_notice' || deadline.state === 'overdue_unshipped') && rank < R_SIP) {
    var sipMiss = outstanding.filter(function (it) { return it.stage === 'shipping_in_process' || it.stage === 'preload'; });
    return 'Move the order to Shipping In Process' + (sipMiss.length ? ' — still missing: ' + sipMiss.slice(0, 3).map(function (it) { return it.label; }).join(', ') : '');
  }
  if (invoice.state === 'missing_overdue') { return 'Create the KTC invoice for this release'; }
  if (invoice.state === 'po_so_only') { return 'Put the release number in the invoice’s Release # field'; }
  if (invoice.state === 'draft_only' || invoice.state === 'in_approval') { return 'Approve invoice ' + invoice.words.split(' ')[0]; }
  if (outstanding.length) { return 'Complete: ' + outstanding.slice(0, 3).map(function (it) { return it.label; }).join(', ') + (outstanding.length > 3 ? ' and ' + (outstanding.length - 3) + ' more' : ''); }
  if (closure.eligible) { return 'Closes automatically in the overnight review'; }
  if (closure.missing && closure.missing.length) { return 'Before closing: ' + closure.missing.slice(0, 2).join('; '); }
  return 'Move to the next stage';
}

// ── which releases each Hub invoice belongs to (several releases per invoice are split) ──
export function releasesOf(text) {
  var out = []; var seen = {};
  String(text || '').split(/\s*(?:[,;&\/+]|\band\b)\s*/i).forEach(function (part) { var raw = part.trim(); var k = relKey(raw); if (k && !seen[k]) { seen[k] = true; out.push(k); } });
  return out;
}

// ── the alert email (plain text + simple HTML) ──
export function alertEmail(ev, link) {
  var o = ev.order || {}; var d = ev.deadline || {};
  var when = d.scheduled ? String(d.scheduled).replace('T', ' ').substring(0, 16) + ' New York time' : '(no time)';
  var head = d.state === 'overdue_unshipped' ? 'Scheduled shipping time has passed and the order is not shipped' : (d.state === 'short_notice' ? 'Scheduled with less than 30 hours’ notice' : 'Not in Shipping In Process 30 hours before shipping');
  var miss = (ev.outstanding || []).filter(function (it) { return it.stage === 'preload' || it.stage === 'shipping_in_process'; }).map(function (it) { return it.label + (it.why ? ' (' + it.why + ')' : ''); });
  if (ev.deposit && ev.deposit.blocked) { miss.unshift(ev.deposit.words); }
  var subject = '⚠ ' + (o.release_number || ('order ' + o.id)) + ' — ' + head;
  var lines = [head + '.', '', 'Release: ' + (o.release_number || '—') + ' (order ' + o.id + ')', 'Customer: ' + (o.customer_name || '—'), 'Destination: ' + (o.country || '—'),
    'Scheduled shipping: ' + when, 'Current stage: ' + (STAGE_LABEL[o.status] || o.status), '', 'Missing / blocking:'].concat(miss.length ? miss.map(function (m) { return '• ' + m; }) : ['• nothing recorded as missing — the stage was simply not moved']).concat(['', 'Open the order: ' + link, '', 'This alert is sent once for this scheduled time. It stops when the order reaches Shipping In Process, ships, is rescheduled or cancelled.']);
  var esc = function (s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;'); };
  var html = '<div style="font-family:Arial,sans-serif;font-size:14px;color:#14202e">' + lines.map(function (l) { return l === '' ? '<br>' : (/^Open the order: /.test(l) ? 'Open the order: <a href="' + esc(link) + '">' + esc(link) + '</a><br>' : esc(l) + '<br>'); }).join('') + '</div>';
  return { subject: subject, text: lines.join('\n'), html: html };
}

// ── v55.83-TM (Max, Nov 17: "Need a reconciliation of orders release numbers from NT warehouse that do not have a linked KTC
// invoice from June 2026 on") — every warehouse order (main + obsolete) active since `since`, whose release number is NOT in the
// Release Number field of any active KTC invoice. Each row says why and offers what would fix it:
//   none           — nothing carries it → create the invoice, or add the release to one of the suggested invoices
//   cancelled_only — only void / cancelled invoices carry it → a new invoice is needed (or the cancellation was a mistake)
//   no_release     — the warehouse order has no release number at all → fill it in Nextrade
//   in_notes       — no invoice field carries it, but an invoice's notes / memo mention it → put it in that invoice's Release Number
//   po_so_only     — LINKED the Wave way (the P.O./S.O. field) but Release Number is empty → one click copies it (the P&L reads Release Number)
// suggestions: active invoices of the same customer with NO release number, dated within 45 days of the order.
// orders: [{ source, id, release_number, customer_name, status, shipped_date, load_date, created_at, link }]
// invoices: [{ id, invoice_number, release_number, po_so_number, record_status, approval_status, invoice_date, customer_name, total_amount }]
export function reconcileReleases(orders, invoices, since) {
  var from = String(since || '2026-06-01').substring(0, 10);
  var byRel = {}; var byPo = {}; var noRel = [];
  (invoices || []).forEach(function (i) {
    var rs = releasesOf(i.release_number); rs.forEach(function (k) { (byRel[k] = byRel[k] || []).push(i); });
    releasesOf(i.po_so_number).forEach(function (k) { (byPo[k] = byPo[k] || []).push(i); });
    if (!rs.length && !releasesOf(i.po_so_number).length && (i.record_status || 'active') === 'active') { noRel.push(i); }
  });
  function isLive(i) { return (i.record_status || 'active') === 'active'; }
  function day(s) { var m = String(s || '').match(/^(\d{4}-\d{2}-\d{2})/); return m ? m[1] : ''; }
  function brief(i) { return { id: i.id, number: i.invoice_number, date: day(i.invoice_date), customer: i.customer_name || null, total: Number(i.total_amount) || 0, approval: i.approval_status || null, record_status: i.record_status || 'active' }; }
  var out = [];
  (orders || []).forEach(function (o) {
    if (o.status === 'cancelled') { return; }
    if (/^\s*test\b/i.test(String(o.customer_name || ''))) { return; }
    var dt = day(o.shipped_date) || day(o.load_date) || day(o.created_at);
    var dk = day(o.shipped_date) ? 'shipped' : (day(o.load_date) ? 'load date' : 'created');
    if (!dt || dt < from) { return; }
    var ks = releasesOf(o.release_number);
    var row = { source: o.source || 'main', order_id: o.id, release_number: o.release_number || '', customer: o.customer_name || '', status: o.status || '', date: dt, date_kind: dk, link: o.link || null, po_so: [], cancelled: [], suggestions: [] };
    if (!ks.length) { row.state = 'no_release'; row.words = 'The warehouse order has no release number — fill it in Nextrade'; out.push(row); return; }
    var on = []; var seen = {};
    ks.forEach(function (k) { (byRel[k] || []).forEach(function (i) { if (!seen[i.id]) { seen[i.id] = true; on.push(i); } }); });
    if (on.some(isLive)) { return; } // linked: an active invoice carries the release
    var po = []; var seenP = {};
    ks.forEach(function (k) { (byPo[k] || []).forEach(function (i) { if (isLive(i) && !seenP[i.id]) { seenP[i.id] = true; po.push(i); } }); });
    row.po_so = po.map(brief); row.cancelled = on.map(brief);
    var noteHits = po.length ? [] : (invoices || []).filter(function (i) { if (!isLive(i) || !i.notes) { return false; } var nk = String(i.notes).toUpperCase().replace(/[^A-Z0-9]/g, ''); return ks.some(function (k) { return k.length >= 6 && nk.indexOf(k) >= 0; }); });
    row.in_notes = noteHits.map(brief);
    var t0 = Date.parse(dt + 'T00:00:00Z');
    row.suggestions = noRel.filter(function (i) { var d0 = Date.parse(day(i.invoice_date) + 'T00:00:00Z'); return !isNaN(d0) && Math.abs(d0 - t0) <= 45 * 86400000 && i.customer_name && o.customer_name && sameCustomer(i.customer_name, o.customer_name); })
      .sort(function (a, b) { return Math.abs(Date.parse(day(a.invoice_date)) - t0) - Math.abs(Date.parse(day(b.invoice_date)) - t0); }).slice(0, 3).map(brief);
    if (po.length) { row.state = 'po_so_only'; row.words = 'Linked the Wave way: invoice ' + po.map(function (i) { return i.invoice_number; }).join(', ') + ' has it in the P.O./S.O. field — its Release Number is empty (the profit report reads Release Number)'; }
    else if (noteHits.length) { row.state = 'in_notes'; row.words = 'Not in any invoice field, but the notes of ' + noteHits.map(function (i) { return i.invoice_number; }).join(', ') + ' mention it'; }
    else if (on.length) { row.state = 'cancelled_only'; row.words = 'Only void / cancelled invoices carry it: ' + on.map(function (i) { return i.invoice_number; }).join(', '); }
    else { row.state = 'none'; row.words = row.suggestions.length ? 'No invoice carries this release — maybe one of the invoices below (same customer, no release number)' : 'No KTC invoice carries this release'; }
    out.push(row);
  });
  var rank = { none: 0, in_notes: 1, cancelled_only: 2, no_release: 3, po_so_only: 4 };
  return out.sort(function (a, b) { return rank[a.state] - rank[b.state] || String(b.date).localeCompare(String(a.date)); });
}
