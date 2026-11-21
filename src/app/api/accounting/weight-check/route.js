// v55.83-XB — BILL-TO-WAREHOUSE WEIGHT CHECK (Max, 21 Nov 2026; plan + Codex plan feedback 21 Nov 10:16).
//
// Compares what suppliers billed (quantity / weight per bill line and reference) with what was actually scanned into the
// NextTrade warehouse, and records an audited decision on every difference. Rules: lib/weight-check.js. Warehouse reads:
// lib/weight-check-feed-server.js (server-only, read-only, the token never reaches the browser). Storage: sql/v55-83-XB-weight-check.sql.
//
// What this route NEVER does: mark a bill paid, validate the bill itself, touch wires, inventory, bill lines, supplier charges,
// the bill's "disputed" flag, or the warehouse. It writes only its own wc_* tables (append-only) and, for "Report an issue", a
// ticket in the existing tickets workflow.
//
// Identity: the verified sign-in (bearer), never a user_id from the body. Permissions (Settings → Banking & Accounting Access):
//   bills.weight_check.view      see the check, the report and the report history
//   bills.weight_check.validate  recheck the warehouse, confirm / reject links, run a report, Validate match, Report an issue, reopen those
//   bills.weight_check.accept    Accept a discrepancy (and reopen an accepted one)
//   bills.weight_check.resolve   Resolve a reported issue (and reopen a resolution)
//   bills.weight_check.settings  product mappings (the tolerance and any pound-per-yard factor: super admin only — Max decides)
// All of them also need Accounting Access + Bills: View (or Manage). Staff see only bills inside their history window.
// SWC-safe: var + string concatenation only.
import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { assertPermission } from '../../../../lib/server-permissions';
import { verifiedCaller } from '../../../../lib/verified-caller';
import { windowFloorFor, clampFrom } from '../../../../lib/visibility-window-server';
import { audit } from '../../../../lib/audit-server';
import { US_WAVE_BUSINESS_ID } from '../../../../lib/business-of';
import { assemble, recheckWarehouse, lastRun, billAllowed, sha, decisionSnapshot, missingTables, latestMaps } from '../../../../lib/weight-check-server';
import { WC_BUILD, allowedDecisions, DECISION_PERM, reportStatus, normRef, vendorKey, billItemKey, OUTCOME_WORDS, STATE_WORDS, BASIS_LABEL } from '../../../../lib/weight-check';
import { warehouseFeedConfig } from '../../../../lib/warehouse-feed-config';

export const maxDuration = 300;
var API_BUILD_MARKER = 'v55.83-XB-weight-check';
var SQL_HINT = 'The weight check needs its tables first: Max runs sql/v55-83-XB-weight-check.sql once in Supabase (it only adds new tables).';
var EVIDENCE_BUCKET = 'bills-private';
var MAX_EVIDENCE_FILES = 3; var MAX_EVIDENCE_B64 = 8000000;
var MAX_BILLS_PER_REPORT = 400;

function admin() { return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY); }
function out(body, status) { return NextResponse.json(Object.assign({ api_build_marker: API_BUILD_MARKER }, body), { status: status || 200 }); }
function bad(msg, status) { return out({ ok: false, error: msg }, status || 400); }
function isoDate(s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) ? String(s) : null; }
function clean(s, n) { return String(s == null ? '' : s).replace(/[\u0000-\u001f]+/g, ' ').trim().substring(0, n || 2000); }

var VIEW_ACTIONS = { bill: 1, report_preview: 1, reports: 1, report: 1, settings_view: 1, people: 1, evidence_url: 1 };
var VALIDATE_ACTIONS = { recheck: 1, link: 1, run_report: 1 };
var SETTINGS_ACTIONS = { map_save: 1, map_retire: 1, tolerance_save: 1 };

export async function POST(req) {
  var body = null;
  try { body = await req.json(); } catch (eB) { return bad('The request was not readable.'); }
  body = body || {};
  var who = await verifiedCaller(req, body, createClient);
  if (who.error) { return bad(who.error, who.status || 401); }
  var userId = who.userId;
  var db = admin();
  var action = String(body.action || '');
  if (!VIEW_ACTIONS[action] && !VALIDATE_ACTIONS[action] && !SETTINGS_ACTIONS[action] && action !== 'decide') { return bad('Unknown action.'); }
  try {
    // ---- gates (server-side, every call)
    var g0 = await assertPermission(db, userId, 'accounting.view', req);
    if (!g0 || g0.ok !== true) { return bad('This needs "Accounting Access" — grant it in Settings → 🏦 Banking & Accounting Access.', 403); }
    var gB = await assertPermission(db, userId, 'bills.manage', req);
    if (!gB || gB.ok !== true) { gB = await assertPermission(db, userId, 'bills.view', req); }
    if (!gB || gB.ok !== true) { return bad('This needs "Bills: View" — grant it in Settings → 🏦 Banking & Accounting Access.', 403); }
    var gV = await assertPermission(db, userId, 'bills.weight_check.view', req);
    if (!gV || gV.ok !== true) { return bad('This needs "Warehouse check: View" — grant it in Settings → 🏦 Banking & Accounting Access.', 403); }
    var ctx = gV.ctx || g0.ctx || {};
    var isSuper = gV.via === 'super_admin' || ctx.isSuperAdmin === true;
    async function can(perm) { var g = await assertPermission(db, userId, perm, req); return !!(g && g.ok === true); }
    if (VALIDATE_ACTIONS[action] && !(await can('bills.weight_check.validate'))) { return bad('This needs "Warehouse check: Validate".', 403); }
    if (SETTINGS_ACTIONS[action] && !(await can('bills.weight_check.settings'))) { return bad('This needs "Warehouse check: Settings".', 403); }
    var win = await windowFloorFor(db, ctx);
    if (win.error) { return bad(win.error, 503); }
    var floor = win.floor || null;
    var cfg = warehouseFeedConfig(process.env);
    var source = cfg.source || 'nextrade-staging';
    var perms = { validate: await can('bills.weight_check.validate'), accept: await can('bills.weight_check.accept'), resolve: await can('bills.weight_check.resolve'), settings: await can('bills.weight_check.settings'), super_admin: isSuper };

    var runs = await lastRun(db);
    var lookups = (runs.lastGood && runs.lastGood.lookups) || {};
    var feedInfo = { source: source, staging: source !== 'nextrade-live', feed_error: cfg.error || null, last_run: runs.last ? runPublic(runs.last) : null, last_good: runs.lastGood ? runPublic(runs.lastGood) : null };

    // ---------------------------------------------------------------- one bill (the "Warehouse Check" box)
    if (action === 'bill' || action === 'recheck' || action === 'link') {
      var billId = clean(body.bill_id, 60);
      var bq = await db.from('vendor_bills').select('id, vendor_name, bill_number, bill_date, other_reference, release_number, record_status, wave_business_id, attachment_path').eq('id', billId).maybeSingle();
      if (bq.error || !bq.data) { return bad('Bill not found.', 404); }
      if (!billAllowed(bq.data, floor)) { return bad('This bill is outside what you may see.', 403); }
      var recheckResult = null;
      if (action === 'recheck') {
        var pre = await assemble(db, [billId], floor, { source: source, lookups: lookups });
        var groupBills = []; pre.items.forEach(function (i) { (i.bill_ids || []).forEach(function (id) { if (pre.bills[id] && !pre.hidden[id] && groupBills.indexOf(pre.bills[id]) < 0) { groupBills.push(pre.bills[id]); } }); });
        if (!groupBills.length) { groupBills = [bq.data]; }
        recheckResult = await recheckWarehouse(db, process.env, userId, 'recheck', groupBills, pre.links);
        await audit(db, userId, 'weight_check_recheck', 'vendor_bill', billId, { ok: recheckResult.ok, run_id: recheckResult.run_id, counts: recheckResult.counts, error: recheckResult.error || null });
        runs = await lastRun(db); lookups = (runs.lastGood && runs.lastGood.lookups) || lookups;
        feedInfo.last_run = runs.last ? runPublic(runs.last) : null; feedInfo.last_good = runs.lastGood ? runPublic(runs.lastGood) : null;
      }
      if (action === 'link') {
        var st = body.state === 'rejected' ? 'rejected' : 'confirmed';
        var rid = clean(body.receipt_id, 40); var basis = clean(body.basis, 30);
        if (!rid) { return bad('Choose the receipt.'); }
        if (!BASIS_LABEL[basis]) { return bad('Unknown link basis.'); }
        var why = clean(body.reason, 1000);
        if (basis === 'manual' && why.length < 5) { return bad('A receipt chosen by hand needs a reason (what shows it is this bill’s receipt).'); }
        if (st === 'rejected' && why.length < 5) { return bad('Say why this receipt is not the bill’s receipt.'); }
        // the receipt must be one the Hub has read (a person never links to a receipt nobody has seen)
        var rv = await db.from('wc_receipt_versions').select('receipt_id, data, state, version_no').eq('source', source).eq('receipt_id', rid).order('version_no', { ascending: false }).limit(1);
        if (rv.error) { throw new Error(rv.error.message); }
        var rec = (rv.data || [])[0];
        if (!rec && st === 'confirmed') { // chosen by hand and never read: read THAT receipt by its id first (authoritative look-up)
          var rr0 = await recheckWarehouse(db, process.env, userId, 'recheck', [], [{ receipt_id: rid }]);
          if (!rr0.ok) { return bad('The warehouse could not be read for receipt ' + rid + ': ' + rr0.error, 503); }
          rv = await db.from('wc_receipt_versions').select('receipt_id, data, state, version_no').eq('source', source).eq('receipt_id', rid).order('version_no', { ascending: false }).limit(1);
          if (rv.error) { throw new Error(rv.error.message); }
          rec = (rv.data || [])[0];
        }
        if (!rec || rec.state !== 'present') { return bad('That receipt has not been read from the warehouse (or it was removed there) — Recheck warehouse first.', 409); }
        var ins = await db.from('wc_links').insert({ bill_id: billId, source: source, receipt_id: rid, basis: basis, bill_value: clean(body.bill_value, 120) || null, receipt_value: clean(body.receipt_value, 120) || (rec.data && rec.data.reference_number) || null, state: st, reason: why || null, actor: userId }).select('id').single();
        if (ins.error) { throw new Error(ins.error.message); }
        await audit(db, userId, st === 'confirmed' ? 'weight_check_link_confirmed' : 'weight_check_link_rejected', 'vendor_bill', billId, { receipt: source + ':' + rid, basis: basis, reason: why || null });
      }
      var A = await assemble(db, [billId], floor, { source: source, lookups: lookups });
      var names = await namesOf(db, A.items);
      return out({ ok: true, bill: billPublic(bq.data), items: A.items.map(function (i) { return itemPublic(i, A, names, lookups); }), receipts: receiptsPublic(A, lookups), recheck: recheckResult, feed: feedInfo,
        tolerance: tolPublic(A.tolerance), permissions: perms, build: WC_BUILD });
    }

    // ---------------------------------------------------------------- a decision
    if (action === 'decide') {
      var kind = String(body.kind || '');
      var bId = clean(body.bill_id, 60); var key = clean(body.item_key, 600);
      var reason = clean(body.reason, 4000);
      if (['validate_match', 'accept_discrepancy', 'report_issue', 'resolve', 'reopen'].indexOf(kind) < 0) { return bad('Unknown decision.'); }
      if (reason.length < 5) { return bad(kind === 'reopen' ? 'Reopening needs a reason.' : kind === 'report_issue' ? 'Explain the issue.' : kind === 'resolve' ? 'Write how it was resolved.' : 'A decision needs a reason (at least a short sentence).'); }
      var bq2 = await db.from('vendor_bills').select('id, vendor_name, bill_number, bill_date, record_status, wave_business_id').eq('id', bId).maybeSingle();
      if (bq2.error || !bq2.data) { return bad('Bill not found.', 404); }
      if (!billAllowed(bq2.data, floor)) { return bad('This bill is outside what you may see.', 403); }
      var D = await assemble(db, [bId], floor, { source: source, lookups: lookups });
      var item = D.items.filter(function (i) { return i.item_key === key; })[0];
      if (!item) { return bad('That line of the check is no longer there — reload the bill.', 409); }
      if (item.outcome === 'limited_access') { return bad('Part of this group is outside your access — it cannot be decided here.', 403); }
      if (String(body.expected_fp || '') !== String(item.comparison_fp || '')) { return bad('The figures changed since you opened this — look at them again before deciding.', 409); }
      var last = item.decision;
      var needPerm;
      if (kind === 'reopen') {
        if (!last || (item.state === 'unreviewed' || item.state === 'reopened')) { return bad('There is no decision to reopen.', 409); }
        needPerm = last.kind === 'accept_discrepancy' ? 'bills.weight_check.accept' : last.kind === 'resolve' ? 'bills.weight_check.resolve' : 'bills.weight_check.validate';
      } else if (kind === 'resolve') {
        if (item.state !== 'issue_open') { return bad('Only an open reported issue can be resolved.', 409); }
        needPerm = DECISION_PERM.resolve;
      } else {
        if (allowedDecisions(item.outcome).indexOf(kind) < 0) { return bad('"' + kind.replace(/_/g, ' ') + '" is not possible for "' + (OUTCOME_WORDS[item.outcome] || item.outcome) + '".', 409); }
        if (item.state === 'issue_open' && kind !== 'report_issue') { return bad('An issue is open on this — resolve it (with evidence) or reopen first.', 409); }
        if ((item.state === 'validated' || item.state === 'accepted' || item.state === 'resolved') && !item.changed) { return bad('This is already decided and unchanged — reopen it first (with a reason) to decide again.', 409); }
        needPerm = DECISION_PERM[kind];
      }
      if (!(await can(needPerm))) { return bad('Your access does not allow this decision (' + needPerm + ').', 403); }
      // evidence: files (stored privately) and / or a written note
      var evidence = [];
      var files = Array.isArray(body.evidence_files) ? body.evidence_files.slice(0, MAX_EVIDENCE_FILES + 1) : [];
      if (files.length > MAX_EVIDENCE_FILES) { return bad('At most ' + MAX_EVIDENCE_FILES + ' evidence files per decision.'); }
      var evNote = clean(body.evidence_note, 2000);
      if (kind === 'resolve' && !files.length && evNote.length < 10) { return bad('A resolution needs evidence: attach a file or write what proves it (at least a sentence).'); }
      for (var fi = 0; fi < files.length; fi++) {
        var f = files[fi] || {}; var b64 = String(f.base64 || '');
        if (b64.length < 50 || b64.length > MAX_EVIDENCE_B64) { return bad('Evidence file ' + (fi + 1) + ' is empty or larger than about 6 MB.'); }
        var safe = clean(f.name, 120).replace(/[^A-Za-z0-9._-]+/g, '_') || 'evidence';
        var pth = 'weight-check/' + new Date().toISOString().substring(0, 10) + '/' + Date.now() + '-' + Math.floor(Math.random() * 1e6) + '-' + safe;
        var up = await db.storage.from(EVIDENCE_BUCKET).upload(pth, Buffer.from(b64, 'base64'), { contentType: clean(f.type, 100) || 'application/octet-stream', upsert: false });
        if (up.error) { return bad('Evidence file could not be stored: ' + up.error.message, 500); }
        evidence.push({ path: pth, name: clean(f.name, 160), type: clean(f.type, 100) || null });
      }
      if (evNote) { evidence.push({ note: evNote }); }
      var assignee = kind === 'report_issue' ? (clean(body.assignee, 60) || null) : null;
      if (assignee) { var au = await db.from('users').select('id, active').eq('id', assignee).maybeSingle(); if (au.error || !au.data || au.data.active === false) { return bad('The person to assign was not found (or is not active).'); } }
      var snap = decisionSnapshot(item, runs.lastGood);
      var ticketId = null;
      var billNames = (item.bill_ids || []).map(function (id) { var b = D.bills[id]; return b ? (b.vendor_name + ' bill ' + (b.bill_number || '?')) : null; }).filter(Boolean).join(', ');
      if (kind === 'report_issue') {
        var fg = item.figures || {};
        var tIns = await db.from('tickets').insert({
          ticket_number: 'WC-' + new Date().toISOString().substring(0, 10).replace(/-/g, '') + '-' + Math.floor(Math.random() * 9000 + 1000),
          title: 'Warehouse weight check: ' + billNames + (item.product_label ? ' — ' + item.product_label : ''),
          description: 'WAREHOUSE WEIGHT CHECK — ISSUE REPORTED\nBills: ' + billNames + '\nReceipts: ' + (item.receipt_keys || []).join(', ') + '\nResult: ' + (OUTCOME_WORDS[item.outcome] || item.outcome)
            + (fg.billed != null ? '\nBilled: ' + fg.billed + ' ' + (fg.unit || '') : '') + (fg.received != null ? '\nScanned in: ' + fg.received + ' ' + (fg.unit || '') : '') + (fg.diff != null ? '\nDifference: ' + fg.diff + ' ' + (fg.unit || '') + (fg.pct != null ? ' (' + fg.pct + '%)' : '') : '')
            + '\n\nISSUE:\n' + reason + '\n\nThis stays open until a resolution with evidence is recorded in Accounting → Bills → Warehouse Check. Reporting an issue does NOT dispute the bill or stop payment.',
          priority: 'medium', status: 'New', assigned_to: assignee || userId, created_by: userId, due_date: new Date(Date.now() + 7 * 864e5).toISOString().substring(0, 10)
        }).select('id').single();
        if (tIns.error) { return bad('Could not create the ticket: ' + tIns.error.message, 500); }
        ticketId = tIns.data.id;
      }
      var dIns = await db.from('wc_decisions').insert({ item_key: key, kind: kind, reason: reason, evidence: evidence, assignee: assignee, ticket_id: ticketId || (kind === 'resolve' && item.issue ? item.issue.ticket_id : null),
        actor: userId, comparison_fp: item.comparison_fp, evidence_hash: sha(snap), snapshot: snap, outcome: item.outcome, bill_ids: item.bill_ids || [] }).select('id, at').single();
      if (dIns.error) { throw new Error(dIns.error.message); }
      if (kind === 'resolve' && item.issue && item.issue.ticket_id) { try { await db.from('tickets').update({ status: 'Resolved', closed_by: userId, closed_at: new Date().toISOString() }).eq('id', item.issue.ticket_id); } catch (eT) { /* the decision stands; the ticket can be closed by hand */ } }
      await audit(db, userId, 'weight_check_' + kind, 'vendor_bill', bId, { item_key: key, decision_id: dIns.data.id, outcome: item.outcome, reason: reason.substring(0, 300), ticket_id: ticketId, evidence_files: evidence.filter(function (e) { return e.path; }).length });
      var A2 = await assemble(db, [bId], floor, { source: source, lookups: lookups });
      var names2 = await namesOf(db, A2.items);
      return out({ ok: true, decision_id: dIns.data.id, items: A2.items.map(function (i) { return itemPublic(i, A2, names2, lookups); }), feed: feedInfo, permissions: perms });
    }

    // ---------------------------------------------------------------- the exception report (preview, or run + save)
    if (action === 'report_preview' || action === 'run_report') {
      var f0 = isoDate(body.date_from); var f1 = isoDate(body.date_to);
      if (!f0 || !f1 || f1 < f0) { return bad('Choose a bill date range (from – to).'); }
      var from = clampFrom(f0, floor);
      var bl = await allRows(function () {
        return db.from('vendor_bills').select('id, vendor_name, bill_number, bill_date, other_reference, release_number, record_status, wave_business_id, bill_type, shipment_direction, attachment_path')
          .gte('bill_date', from).lte('bill_date', f1).order('bill_date', { ascending: true });
      });
      bl = bl.filter(function (b) { return billAllowed(b, floor); });
      var withItems = {};
      var idsAll = bl.map(function (b) { return b.id; });
      for (var ci = 0; ci < idsAll.length; ci += 200) { (await allRows(function () { return db.from('vendor_bill_lines').select('bill_id').eq('line_kind', 'item').in('bill_id', idsAll.slice(ci, ci + 200)); })).forEach(function (l) { withItems[l.bill_id] = true; }); }
      bl = bl.filter(function (b) { return withItems[b.id] || (b.bill_type === 'supplier' && b.shipment_direction === 'inbound'); });
      var vq = clean(body.vendor, 80).toLowerCase(); var rq = normRef(body.reference);
      if (vq) { bl = bl.filter(function (b) { return String(b.vendor_name || '').toLowerCase().indexOf(vq) >= 0; }); }
      if (bl.length > MAX_BILLS_PER_REPORT) { return bad(bl.length + ' bills in that range — narrow it (at most ' + MAX_BILLS_PER_REPORT + ' per report).'); }
      var ids = bl.map(function (b) { return b.id; });
      var rr = null;
      var refreshSince = new Date(Date.now() - 60000).toISOString(); // a receipt read whole from now on counts as refreshed by this report (1 min clock margin)
      body.__since = refreshSince;
      if (action === 'run_report' && body.recheck !== false && ids.length) {
        var preR = await assemble(db, ids, floor, { source: source, lookups: lookups });
        var vis = ids.map(function (id) { return preR.bills[id]; }).filter(Boolean);
        rr = await recheckWarehouse(db, process.env, userId, 'report', vis, preR.links);
        runs = await lastRun(db); lookups = (runs.lastGood && runs.lastGood.lookups) || lookups;
        feedInfo.last_run = runs.last ? runPublic(runs.last) : null; feedInfo.last_good = runs.lastGood ? runPublic(runs.lastGood) : null;
      }
      var R = ids.length ? await assemble(db, ids, floor, { source: source, lookups: lookups }) : { items: [], bills: {}, hidden: {}, tolerance: null, receipts: {} };
      var namesR = await namesOf(db, R.items);
      var rows = R.items.map(function (i) { return itemPublic(i, R, namesR, lookups); });
      // filters apply AFTER the whole-group calculation (Codex: never filter first)
      if (rq) { rows = rows.filter(function (r) { return (r.references || []).some(function (x) { return normRef(x).indexOf(rq) >= 0; }) || (r.receipts || []).some(function (x) { return normRef(x.reference_number).indexOf(rq) >= 0; }); }); }
      var wq = clean(body.warehouse, 80).toLowerCase();
      if (wq) { rows = rows.filter(function (r) { return (r.receipts || []).some(function (x) { return String(x.warehouse || '').toLowerCase().indexOf(wq) >= 0; }); }); }
      var sq = clean(body.status, 40);
      if (sq) { rows = rows.filter(function (r) { return r.outcome === sq || r.state === sq; }); }
      var revq = clean(body.reviewer, 60);
      if (revq) { rows = rows.filter(function (r) { return (r.decision && (r.decision.actor === revq || r.decision.assignee === revq)) || (r.issue && r.issue.assignee === revq); }); }
      if (body.unresolved === true) { rows = rows.filter(function (r) { return r.state === 'issue_open'; }); }
      // Codex 11:30 — freshness is apart from approval. An item whose receipts were not read whole during THIS report's refresh
      // keeps its decision and evidence, but is marked stale (with its last verified time) and shown in the default list.
      var fresh = freshnessOf(action, body, ids.length, rr);
      rows.forEach(function (r) {
        var hasRec = (r.receipts || []).length > 0;
        // a preview is labelled "from the stored copy" as a whole; only receipts never read whole are flagged there
        r.stale = fresh.kind === 'stored_copy' ? (hasRec && !r.last_verified_at)
          : fresh.kind !== 'refreshed' ? hasRec : (hasRec && (!r.last_verified_at || String(r.last_verified_at) < fresh.since));
      });
      var summary = summarise(rows);
      summary.stale = rows.filter(function (r) { return r.stale && r.needs_attention; }).length;
      function defaultRows() { return rows.filter(function (r) { return r.outstanding || (r.stale && r.needs_attention); }); }
      if (action === 'report_preview') {
        var shown = body.all === true ? rows : defaultRows();
        return out({ ok: true, rows: shown, all_count: rows.length, summary: summary, freshness: freshWords(fresh, rows, runs), bills_checked: ids.length, from: from, to: f1, window_floor: floor, feed: feedInfo, tolerance: tolPublic(R.tolerance), permissions: perms });
      }
      // run_report: save it, numbered, frozen as it stands (every item, not only the outstanding ones)
      var status = reportStatus(rows.map(function (r) { return { needs_attention: r.needs_attention, state: r.state }; }));
      var fw = freshWords(fresh, rows, runs);
      if (fw.qualified) { status = { open: status.open, blocked: status.blocked, complete: false, words: fw.words + ' · ' + (status.complete ? 'every item decided on that data — not confirmed current' : status.words) }; }
      var refsChecked = {}; bl.forEach(function (b) { if (b.other_reference) { refsChecked[b.other_reference] = true; } });
      var payload = { run_by: userId, date_from: from, date_to: f1, filters: { vendor: vq || null, reference: rq || null, warehouse: wq || null, status: sq || null, reviewer: revq || null, unresolved: body.unresolved === true, window_floor: floor },
        source: source, fetch_run_id: rr && rr.run_id ? rr.run_id : (runs.lastGood ? runs.lastGood.id : null), feed_generated_at: runs.lastGood ? runs.lastGood.feed_generated_at : null,
        bills_checked: bl.map(function (b) { return { id: b.id, vendor: b.vendor_name, bill_number: b.bill_number, bill_date: b.bill_date, reference: b.other_reference || null }; }), references_checked: Object.keys(refsChecked),
        counts: Object.assign({}, summary, { freshness: fw, recheck: rr ? { ok: rr.ok, complete: rr.complete === true, error: rr.error || null, counts: rr.counts } : null }), status_at_run: status.words, build: WC_BUILD };
      var itemsP = rows.map(function (r) { return { item_key: r.item_key, bill_ids: r.bill_ids || [], bill_dates: (r.bills || []).map(function (b) { return b.bill_date || ''; }), outcome: r.outcome, state: r.state || 'not_applicable', needs_attention: !!r.needs_attention, row: r, comparison_fp: r.comparison_fp || null, evidence_hash: sha(r), decision_id: r.decision ? r.decision.id : null }; });
      var sv = await db.rpc('wc_save_report', { p_report: payload, p_items: itemsP });
      if (sv.error) { throw new Error(sv.error.message); }
      await audit(db, userId, 'weight_check_report_run', 'wc_report', sv.data.id, { report_no: sv.data.report_no, from: from, to: f1, items: itemsP.length, status: status.words, recheck_ok: rr ? rr.ok : null });
      return out({ ok: true, report: { id: sv.data.id, report_no: sv.data.report_no, status: status.words, complete: status.complete }, rows: body.all === true ? rows : defaultRows(), all_count: rows.length, summary: summary, freshness: fw, recheck: rr, feed: feedInfo, permissions: perms });
    }

    // ---------------------------------------------------------------- report history
    if (action === 'reports') {
      var rl = await db.from('wc_reports').select('id, report_no, run_by, run_at, date_from, date_to, filters, source, status_at_run, counts, feed_generated_at, fetch_run_id, build, bills_checked, references_checked').order('run_at', { ascending: false }).limit(300);
      if (rl.error) { throw new Error(rl.error.message); }
      // a report wholly before the viewer's window is not listed at all (same rule as opening it by id)
      var list = (rl.data || []).filter(function (r) { return !floor || (!!r.date_to && String(r.date_to) >= floor); });
      // Codex 11:39 — reports partly outside the window: the header is rebuilt from the viewer's own items only
      var partIds = list.filter(function (r) { return reportPartialFor(r, floor); }).map(function (r) { return r.id; });
      var frozenBy = {};
      for (var cp = 0; cp < partIds.length; cp += 50) { (await allRows(function () { return db.from('wc_report_items').select('report_id, bill_dates, outcome, state, needs_attention, row').in('report_id', partIds.slice(cp, cp + 50)); })).forEach(function (it) { (frozenBy[it.report_id] = frozenBy[it.report_id] || []).push(it); }); }
      var nm = await userNames(db, list.map(function (r) { return r.run_by; }));
      return out({ ok: true, reports: list.map(function (r) {
        var vis = (frozenBy[r.id] || []).filter(function (it) { return (it.bill_dates || []).every(function (d) { return billInWindow(d, floor); }); });
        var v = viewReport(r, floor, vis); delete v.bills_checked; delete v.references_checked; // the list never carries bill identities
        return Object.assign(v, { run_by_name: nm[r.run_by] || 'someone' });
      }), window_floor: floor, permissions: perms });
    }
    if (action === 'report') {
      var rp = await db.from('wc_reports').select('*').eq('id', clean(body.id, 60)).maybeSingle();
      if (rp.error || !rp.data) { return bad('Report not found.', 404); }
      // wholly before the viewer's window = not theirs to open (same answer as a report that does not exist)
      if (floor && (!rp.data.date_to || String(rp.data.date_to) < floor)) { return bad('Report not found.', 404); }
      var its = await allRows(function () { return db.from('wc_report_items').select('seq, item_key, bill_ids, bill_dates, outcome, state, needs_attention, row, comparison_fp, decision_id').eq('report_id', rp.data.id).order('seq', { ascending: true }); });
      // the viewer sees only items whose bills are all inside their window; anything else makes the view PARTIAL
      var hiddenN = 0;
      var visIts = its.filter(function (it) { var ok = (it.bill_dates || []).every(function (d) { return billInWindow(d, floor); }); if (!ok) { hiddenN++; } return ok; });
      var repView = viewReport(rp.data, floor, visIts);
      var keysR = visIts.map(function (i) { return i.item_key; });
      var decsR = [];
      for (var ck = 0; ck < keysR.length; ck += 200) { decsR = decsR.concat(await allRows(function () { return db.from('wc_decisions').select('id, item_key, kind, reason, actor, at, assignee, ticket_id, evidence').in('item_key', keysR.slice(ck, ck + 200)).gt('at', rp.data.run_at).order('at', { ascending: true }); })); }
      // the CURRENT state of the same items (recomputed) — kept apart from the frozen state and the later events
      var billIdsR = {}; visIts.forEach(function (i) { (i.bill_ids || []).forEach(function (b) { billIdsR[b] = true; }); });
      var cur = {};
      var bIds = Object.keys(billIdsR);
      if (bIds.length && body.with_current !== false) {
        try { var C = await assemble(db, bIds, floor, { source: source, lookups: lookups }); C.items.forEach(function (i) { cur[i.item_key] = { state: i.state, state_words: i.state_words, outcome: i.outcome, outcome_words: i.outcome_words, changed: i.changed }; }); }
        catch (eC) { cur = null; }
      }
      var nmR = await userNames(db, decsR.map(function (d) { return d.actor; }).concat(decsR.map(function (d) { return d.assignee; })).concat([rp.data.run_by]));
      var later = {}; decsR.forEach(function (d) { (later[d.item_key] = later[d.item_key] || []).push({ kind: d.kind, reason: d.reason, at: d.at, actor_name: nmR[d.actor] || 'someone', assignee_name: d.assignee ? (nmR[d.assignee] || 'someone') : null, ticket_id: d.ticket_id, evidence: d.evidence || [] }); });
      var curStatus = cur ? reportStatus(visIts.map(function (i) { var c = cur[i.item_key]; return { needs_attention: i.needs_attention, state: c ? c.state : i.state }; })) : null;
      var isPart = hiddenN > 0 || repView.partial;
      return out({ ok: true, report: Object.assign(repView, { run_by_name: nmR[rp.data.run_by] || 'someone' }), partial: isPart, partial_words: isPart ? 'PARTIAL — this report covers bills outside your permitted dates; only your part is shown, and its totals and status count only that part' : null,
        items: visIts.map(function (i) { return { seq: i.seq, item_key: i.item_key, frozen: i.row, frozen_state: i.state, outcome: i.outcome, needs_attention: i.needs_attention, later: later[i.item_key] || [], current: cur ? (cur[i.item_key] || { state: 'not_found_now', state_words: 'Not found in the current check (bill or link changed)' }) : null }; }),
        current_status: curStatus, current_note: runs.lastGood ? 'from the Hub’s stored warehouse copy, last successful read ' + String(runs.lastGood.finished_at || '').substring(0, 16).replace('T', ' ') + ' UTC' : 'the warehouse has not been read successfully yet',
        window_floor: floor, permissions: perms });
    }

    // ---------------------------------------------------------------- settings (mappings, tolerance), people, evidence
    if (action === 'settings_view') {
      var mp = await allRows(function () { return db.from('wc_product_maps').select('*').order('at', { ascending: false }); });
      var tl = await db.from('wc_tolerances').select('*').order('version', { ascending: false }).limit(20);
      if (tl.error) { throw new Error(tl.error.message); }
      var nmS = await userNames(db, mp.map(function (m) { return m.actor; }).concat((tl.data || []).map(function (t) { return t.actor; })));
      return out({ ok: true, maps: latestMaps(mp).map(function (m) { return Object.assign({}, m, { actor_name: nmS[m.actor] || 'someone' }); }), map_history: mp.length, tolerances: (tl.data || []).map(function (t) { return Object.assign({}, t, { actor_name: nmS[t.actor] || 'someone' }); }),
        lookups: lookups, feed: feedInfo, permissions: perms });
    }
    if (action === 'people') {
      var pp = await db.from('users').select('id, name, active').eq('active', true).order('name', { ascending: true }).limit(500);
      if (pp.error) { throw new Error(pp.error.message); }
      return out({ ok: true, people: (pp.data || []).map(function (u) { return { id: u.id, name: u.name || 'someone' }; }) });
    }
    if (action === 'evidence_url') {
      var dq = await db.from('wc_decisions').select('id, evidence, bill_ids').eq('id', clean(body.decision_id, 60)).maybeSingle();
      if (dq.error || !dq.data) { return bad('Decision not found.', 404); }
      var path = clean(body.path, 400);
      if (!(dq.data.evidence || []).some(function (e) { return e && e.path === path; })) { return bad('That file is not part of this decision.', 403); }
      var bs = await db.from('vendor_bills').select('id, bill_date, record_status, wave_business_id').in('id', dq.data.bill_ids || []);
      if (bs.error || !(bs.data || []).length || !(bs.data || []).every(function (b) { return billAllowed(b, floor); })) { return bad('This evidence belongs to a bill outside what you may see.', 403); }
      var su = await db.storage.from(EVIDENCE_BUCKET).createSignedUrl(path, 600);
      if (su.error) { return bad('The file could not be opened: ' + su.error.message, 500); }
      return out({ ok: true, url: su.data.signedUrl });
    }
    if (action === 'map_save') {
      var vName = clean(body.vendor_name, 160); var line = { item_key: body.item_key, description: body.bill_description };
      var ik = billItemKey(line); var vk = vendorKey(vName);
      if (!vk || !ik) { return bad('The mapping needs the vendor and the bill product.'); }
      var wh = { wh_product_type: clean(body.wh_product_type, 40) || null, wh_cgt: clean(body.wh_cgt, 40) || null, wh_nt: clean(body.wh_nt, 40) || null, wh_color: clean(body.wh_color, 40) || null };
      if (!wh.wh_product_type && !wh.wh_cgt && !wh.wh_nt && !wh.wh_color) { return bad('Choose the warehouse product (at least its product type or grade).'); }
      var lbpy = body.lb_per_yd === '' || body.lb_per_yd == null ? null : Number(body.lb_per_yd);
      if (lbpy !== null && !(lbpy > 0 && lbpy < 100)) { return bad('Pounds per yard must be a positive number.'); }
      var approveFactor = body.lb_factor_approved === true && lbpy !== null;
      if (approveFactor && !isSuper) { return bad('Only the super admin approves a pounds-per-yard factor for the weight check (Max decides).', 403); }
      var note = clean(body.note, 1000);
      var fam = clean(body.family, 60) || null; var ver = 1;
      if (fam) { var fv = await db.from('wc_product_maps').select('version').eq('family', fam).order('version', { ascending: false }).limit(1); if (fv.error) { throw new Error(fv.error.message); } ver = ((fv.data || [])[0] || { version: 0 }).version + 1; if (ver === 1) { return bad('That mapping was not found.', 404); } }
      else {
        var dup = await db.from('wc_product_maps').select('family, version, state').eq('vendor_key', vk).eq('item_key', ik).eq('bill_unit', clean(body.bill_unit, 20).toUpperCase());
        if (dup.error) { throw new Error(dup.error.message); }
        if (latestMaps(dup.data || []).length) { return bad('This bill product already has a mapping — change that one instead (its history is kept).', 409); }
        fam = cryptoRandomId();
      }
      var mi = await db.from('wc_product_maps').insert(Object.assign({ family: fam, version: ver, state: 'active', vendor_key: vk, item_key: ik, bill_unit: clean(body.bill_unit, 20).toUpperCase(), bill_description: clean(body.bill_description, 300) || null,
        wh_label: clean(body.wh_label, 200) || null, lb_per_yd: lbpy, lb_factor_approved: approveFactor, note: note || null, actor: userId }, wh)).select('id, family, version').single();
      if (mi.error) { throw new Error(mi.error.message); }
      await audit(db, userId, 'weight_check_map_saved', 'wc_product_map', mi.data.id, { family: fam, version: ver, vendor: vk, item: ik, wh: wh, lb_per_yd: lbpy, factor_approved: approveFactor });
      return out({ ok: true, map: mi.data });
    }
    if (action === 'map_retire') {
      var famR = clean(body.family, 60); var whyR = clean(body.reason, 1000);
      if (whyR.length < 5) { return bad('Say why this mapping is retired.'); }
      var lastM = await db.from('wc_product_maps').select('*').eq('family', famR).order('version', { ascending: false }).limit(1);
      if (lastM.error) { throw new Error(lastM.error.message); }
      var m0 = (lastM.data || [])[0]; if (!m0 || m0.state !== 'active') { return bad('That mapping is not active.', 409); }
      var copy = Object.assign({}, m0, { id: undefined, at: undefined, version: m0.version + 1, state: 'retired', note: whyR, actor: userId });
      delete copy.id; delete copy.at;
      var ri = await db.from('wc_product_maps').insert(copy).select('id').single();
      if (ri.error) { throw new Error(ri.error.message); }
      await audit(db, userId, 'weight_check_map_retired', 'wc_product_map', ri.data.id, { family: famR, reason: whyR });
      return out({ ok: true });
    }
    if (action === 'tolerance_save') {
      if (!isSuper) { return bad('Only the super admin sets the tolerance (Max approves it).', 403); }
      var pct = body.pct === '' || body.pct == null ? null : Number(body.pct); var lbT = body.lb === '' || body.lb == null ? null : Number(body.lb);
      if ((pct === null && lbT === null) || (pct !== null && !(pct >= 0 && pct <= 100)) || (lbT !== null && !(lbT >= 0))) { return bad('Give a % and / or a number of pounds (0 or more).'); }
      var tv = await db.from('wc_tolerances').select('version').order('version', { ascending: false }).limit(1);
      if (tv.error) { throw new Error(tv.error.message); }
      var nv = ((tv.data || [])[0] || { version: 0 }).version + 1;
      var tIns2 = await db.from('wc_tolerances').insert({ version: nv, pct: pct, lb: lbT, note: clean(body.note, 1000) || null, actor: userId }).select('id, version').single();
      if (tIns2.error) { throw new Error(tIns2.error.message); }
      await audit(db, userId, 'weight_check_tolerance_saved', 'wc_tolerance', tIns2.data.id, { version: nv, pct: pct, lb: lbT });
      return out({ ok: true, tolerance: tIns2.data });
    }
    return bad('Unknown action.');
  } catch (e) {
    var msg = (e && e.message) || 'unexpected error';
    if (missingTables(msg)) { return out({ ok: false, sql_missing: true, error: SQL_HINT }, 503); }
    return out({ ok: false, error: 'The warehouse check failed: ' + msg }, 500);
  }
}

// ---------------------------------------------------------------- helpers
function cryptoRandomId() { return crypto.randomUUID(); }
async function allRows(q) {
  var outR = []; var from = 0;
  for (var g = 0; g < 60; g++) { var r = await q().range(from, from + 999); if (r.error) { throw new Error(r.error.message); } outR = outR.concat(r.data || []); if (!r.data || r.data.length < 1000) { break; } from += 1000; }
  return outR;
}
async function userNames(db, ids) {
  var u = {}; var list = ids.filter(function (x, i, a) { return x && a.indexOf(x) === i; });
  if (!list.length) { return u; }
  var r = await db.from('users').select('id, name').in('id', list.slice(0, 500));
  ((r && r.data) || []).forEach(function (x) { u[x.id] = x.name || 'someone'; });
  return u;
}
async function namesOf(db, items) {
  var ids = [];
  items.forEach(function (i) { (i.history || []).forEach(function (d) { ids.push(d.actor); if (d.assignee) { ids.push(d.assignee); } }); (i.links || []).forEach(function (l) { ids.push(l.actor); }); });
  return userNames(db, ids);
}
function runPublic(r) { return { at: r.finished_at || r.started_at, ok: r.ok, complete: r.complete, error: r.ok ? null : r.error, source: r.source, site: r.site, feed_generated_at: r.feed_generated_at }; }
function tolPublic(t) { return t ? { version: t.version, pct: t.pct, lb: t.lb, at: t.at } : null; }
function billPublic(b) { return { id: b.id, vendor_name: b.vendor_name, bill_number: b.bill_number, bill_date: b.bill_date, other_reference: b.other_reference, attachment_path: b.attachment_path || null }; }
function receiptsPublic(A, lookups) {
  var o = {};
  Object.keys(A.receipts).forEach(function (k) { var r = A.receipts[k]; o[k] = receiptPublic(r); });
  return o;
}
function receiptPublic(r) {
  if (!r) { return null; }
  return { key: (r.source || '') + ':' + r.id, id: r.id, state: r.state, reference_number: r.reference_number || null, nexpac_bill: r.nexpac_bill || null, cgt_reference: r.info ? r.info.cgt_reference || null : null,
    container: r.info ? r.info.container_trailer_number || null : null, uom: r.info ? r.info.uom || null : null, receipt_date: r.receipt_date || null, is_draft: Number(r.is_draf) === 1,
    supplier: r.supplier ? r.supplier.name : null, warehouse: r.warehouse ? r.warehouse.name : null, gross_weight_note: r.info && r.info.inbound_weight_gross ? 'gross (truck scale): ' + r.info.inbound_weight_gross + ' — never compared with net goods' : null,
    declared: r.info ? { quantity: r.info.declared_quantity, rolls: r.info.declared_roll_count, discrepancy_flag: r.info.has_discrepancy ? (r.info.discrepancy_type || 'yes') : null } : null,
    scans: (r.logs || []).length };
}
// what the browser receives for one item: only bills the viewer may see; no money at all
function itemPublic(i, A, names, lookups) {
  var bills = (i.bill_ids || []).filter(function (id) { return !A.hidden[id]; }).map(function (id) { var b = A.bills[id] || {}; return { id: id, bill_number: b.bill_number, vendor: b.vendor_name, bill_date: b.bill_date, reference: b.other_reference, attachment_path: b.attachment_path || null }; });
  var recs = (i.receipt_keys || []).map(function (k) { return receiptPublic(A.receipts[k]) || { key: k, state: 'not_read' }; });
  function dec(d) { return d ? Object.assign({}, d, { actor_name: names[d.actor] || 'someone', assignee_name: d.assignee ? (names[d.assignee] || 'someone') : null }) : null; }
  var limited = i.outcome === 'limited_access';
  return {
    item_key: i.item_key, kind: i.kind, outcome: i.outcome, outcome_words: i.outcome_words, reasons: i.reasons || [], provisional: !!i.provisional,
    bill_ids: limited ? bills.map(function (b) { return b.id; }) : (i.bill_ids || []), bills: bills, references: bills.map(function (b) { return b.reference; }).filter(Boolean), receipts: recs,
    product_label: i.product_label || null, figures: limited ? null : (i.figures || null), bill_lines: limited ? null : (i.bill_lines || null),
    scan_rows: limited ? null : (i.scan_rows || []).map(function (s) { return { id: s.id, receipt_key: s.receipt_key, skew: s.skew, pallet: s.pallet, lb: s.lb, yd: s.yd, rolls: s.rolls, pl_kg: s.pl_kg, scanned_out: s.scanned_out, sold_by: s.sold_by }; }),
    links: limited ? [] : (i.links || []).map(function (l) { return Object.assign({}, l, { actor_name: names[l.actor] || 'someone' }); }),
    candidates: i.candidates || null, needs_link: !!i.needs_link, needs_mapping: !!i.needs_mapping, searched_at: i.searched_at || null,
    needs_decision: !!i.needs_decision, needs_attention: !!i.needs_attention, allowed: i.needs_decision ? allowedDecisions(i.outcome) : [], state: i.state, state_words: i.state_words, outstanding: !!i.outstanding,
    decision: dec(i.decision), issue: dec(i.issue), history: (i.history || []).map(dec), changed: i.changed || null, comparison_fp: i.comparison_fp || null,
    last_verified_at: limited ? null : (i.last_verified_at || null), stale: false
  };
}
// Codex 11:39 — a saved report seen by someone with a narrower date window. The stored report is never changed; the viewer
// gets a header rebuilt ONLY from what they may see (their bills, their references, their items' counts and status).
function billInWindow(d, floor) { return !floor || (!!d && String(d) >= floor); }
function reportPartialFor(r, floor) {
  if (!floor) { return false; }
  if (!r.date_from || String(r.date_from) < floor) { return true; }
  return (r.bills_checked || []).some(function (b) { return !billInWindow(b.bill_date, floor); });
}
var FRESH_LEAD = { refresh_failed: 'Refresh failed', refresh_incomplete: 'Refresh incomplete', not_refreshed: 'Saved without refreshing' };
function viewReport(r, floor, visFrozen) {
  if (!reportPartialFor(r, floor)) { return Object.assign({}, r, { partial: false }); }
  var bills = (r.bills_checked || []).filter(function (b) { return billInWindow(b.bill_date, floor); });
  var refs = {}; bills.forEach(function (b) { if (b.reference) { refs[b.reference] = true; } });
  var rows = (visFrozen || []).map(function (i) { return Object.assign({}, i.row || {}, { outcome: i.outcome, state: i.state, needs_attention: i.needs_attention }); });
  var s = summarise(rows);
  var st = reportStatus(rows.map(function (x) { return { needs_attention: x.needs_attention, state: x.state }; }));
  var fk = r.counts && r.counts.freshness ? r.counts.freshness.kind : null;
  var f = r.filters || {};
  return {
    id: r.id, report_no: r.report_no, run_by: r.run_by, run_at: r.run_at, date_from: r.date_from, date_to: r.date_to, source: r.source,
    fetch_run_id: r.fetch_run_id, feed_generated_at: r.feed_generated_at, build: r.build,
    filters: { status: f.status || null, unresolved: !!f.unresolved, other_filters_hidden: !!(f.vendor || f.reference || f.warehouse || f.reviewer) },
    bills_checked: bills, references_checked: Object.keys(refs),
    counts: Object.assign(s, { partial_totals: true, freshness: fk ? { kind: fk } : null }),
    status_at_run: 'PARTIAL — of the items you may see: ' + (FRESH_LEAD[fk] ? FRESH_LEAD[fk] + ' · ' : '') + st.words,
    partial: true
  };
}
// Codex 11:30 — did THIS report read the warehouse? refreshed / refresh_failed / refresh_incomplete / not_refreshed / stored_copy
function freshnessOf(action, body, nBills, rr) {
  if (action === 'report_preview') { return { kind: 'stored_copy', since: body.__since }; }
  if (body.recheck === false) { return { kind: 'not_refreshed', since: body.__since }; }
  if (!nBills) { return { kind: 'refreshed', since: body.__since }; }
  if (!rr || rr.ok !== true) { return { kind: 'refresh_failed', since: body.__since, error: (rr && rr.error) || 'the warehouse was not read' }; }
  if (rr.complete === false) { return { kind: 'refresh_incomplete', since: body.__since }; }
  return { kind: 'refreshed', since: body.__since };
}
function freshWords(f, rows, runs) {
  var stale = rows.filter(function (r) { return r.stale && r.needs_attention; });
  var oldest = stale.map(function (r) { return r.last_verified_at; }).filter(Boolean).sort()[0] || null;
  var lead = f.kind === 'refresh_failed' ? 'Refresh failed' : f.kind === 'refresh_incomplete' ? 'Refresh incomplete' : f.kind === 'not_refreshed' ? 'Saved without refreshing' : f.kind === 'stored_copy' ? 'From the stored warehouse copy (not refreshed now)' : 'Refreshed now';
  var qualified = f.kind !== 'refreshed' && f.kind !== 'stored_copy' ? true : stale.length > 0 && f.kind === 'refreshed';
  var words = lead + (stale.length ? ' — using last verified warehouse data for ' + stale.length + ' item' + (stale.length === 1 ? '' : 's') + (oldest ? ' (oldest read ' + String(oldest).substring(0, 16).replace('T', ' ') + ' UTC)' : ' (some never read whole)') : '');
  return { kind: f.kind, qualified: qualified, words: words, stale_items: stale.length, oldest_verified_at: oldest, error: f.error || null, last_good_read: runs && runs.lastGood ? runs.lastGood.finished_at : null };
}
function summarise(rows) {
  var s = { items: rows.length, outstanding: 0, blocked: 0, by_outcome: {}, by_state: {} };
  rows.forEach(function (r) { if (r.outstanding) { s.outstanding++; } s.by_outcome[r.outcome] = (s.by_outcome[r.outcome] || 0) + 1; if (r.needs_attention) { s.by_state[r.state] = (s.by_state[r.state] || 0) + 1; } if (r.outstanding && (r.state === 'not_checked' || r.state === 'limited' || r.state === 'blocked')) { s.blocked++; } });
  return s;
}
