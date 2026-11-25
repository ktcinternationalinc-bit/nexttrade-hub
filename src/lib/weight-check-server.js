// v55.83-XB — weight check, server side: the Hub's dated copy of warehouse receipts, the bills a person may see, and the
// comparison with its decisions. Server-only (uses node crypto). The rules themselves are in ./weight-check.js.
// SWC-safe: var + string concatenation.
import crypto from 'crypto';
import { canonical, normRef, billReferences, proposeLinks, currentLinks, buildGroups, compareGroup, unlinkedBillItem, decisionState, isOutstanding,
  needsDecision, needsAttention, blockedState, diffInputs, receiptKey, WC_BUILD, OUTCOME_WORDS, STATE_WORDS, BASIS_LABEL, vendorKey } from './weight-check';
import { fetchReceipts, MAX_IDS, MAX_REFS } from './weight-check-feed-server';
import { US_WAVE_BUSINESS_ID } from './business-of';

export function sha(x) { return crypto.createHash('sha256').update(typeof x === 'string' ? x : canonical(x)).digest('hex'); }
var PAGE = 1000;
async function all(q) {
  var out = []; var from = 0;
  for (var guard = 0; guard < 60; guard++) {
    var r = await q().range(from, from + PAGE - 1);
    if (r.error) { throw new Error(r.error.message); }
    out = out.concat(r.data || []);
    if (!r.data || r.data.length < PAGE) { break; }
    from += PAGE;
  }
  return out;
}
function chunks(a, n) { var out = []; for (var i = 0; i < a.length; i += n) { out.push(a.slice(i, i + n)); } return out; }
// v55.83-YX (Max 25 Nov: "warehouse check should only look at nexpac bills and only vendors we select").
// The selection is versioned in wc_vendor_scope (sql/v55-83-YX-wc-vendor-scope.sql). Until Max saves one — or before that
// SQL is run — the scope is NexPac only. A vendor is in scope when its vendorKey() is in the latest selection.
export function defaultVendorScope() { return { version: 0, vendor_keys: ['nexpac'], vendor_names: ['NexPac Corporation'], is_default: true, at: null, actor: null, note: null }; }
export async function loadVendorScope(db) {
  var r = await db.from('wc_vendor_scope').select('*').order('version', { ascending: false }).limit(1);
  if (r.error) {
    if (missingTables(r.error.message)) { return Object.assign(defaultVendorScope(), { table_missing: true }); }
    throw new Error(r.error.message);
  }
  var row = (r.data || [])[0];
  if (!row) { return defaultVendorScope(); }
  var keys = (row.vendor_keys || []).slice(); var names = (row.vendor_names || []).slice();
  // Max's rule is "NexPac AND the vendors we select": NexPac is always in, whatever a saved selection holds (Codex 25 Nov)
  if (keys.indexOf('nexpac') < 0) { keys.unshift('nexpac'); names.unshift('NexPac Corporation'); }
  return { version: row.version, vendor_keys: keys, vendor_names: names, is_default: false, at: row.at || null, actor: row.actor || null, note: row.note || null };
}
export function inVendorScope(scope, vendorName) {
  var k = vendorKey(vendorName);
  return !!k && !!scope && Array.isArray(scope.vendor_keys) && scope.vendor_keys.indexOf(k) >= 0;
}
export function missingTables(msg) { return /wc_[a-z_]+/.test(String(msg || '')) && /does not exist|schema cache|could not find/i.test(String(msg || '')); }

// ---------------------------------------------------------------- which bills a person may see
// KTC (US) bills only, not deleted / void, and never dated before the person's history window (super admin: all).
export function billAllowed(b, floor) {
  if (!b) { return false; }
  if (b.record_status === 'deleted' || b.record_status === 'void' || b.record_status === 'archived') { return false; }
  if (b.wave_business_id && b.wave_business_id !== US_WAVE_BUSINESS_ID) { return false; }
  if (floor && (!b.bill_date || String(b.bill_date).substring(0, 10) < floor)) { return false; }
  return true;
}
var BILL_COLS = 'id, vendor_name, bill_number, bill_date, other_reference, release_number, warehouse_reference, bill_type, shipment_direction, record_status, wave_business_id, attachment_path, validation_status';

// ---------------------------------------------------------------- the warehouse copy
async function startRun(db, trigger, userId, source) {
  var r = await db.from('wc_fetch_runs').insert({ trigger: trigger, triggered_by: userId || null, source: source || 'unknown' }).select('id').single();
  if (r.error) { throw new Error(r.error.message); }
  return r.data.id;
}
async function finishRun(db, runId, fields) { await db.from('wc_fetch_runs').update(Object.assign({ finished_at: new Date().toISOString() }, fields)).eq('id', runId).is('finished_at', null); }

export async function latestVersions(db, source, ids) {
  var out = {};
  var L_c = chunks(ids, 200); for (var i_c = 0; i_c < L_c.length; i_c++) { var c = L_c[i_c];
    var rows = await all(function () { return db.from('wc_receipt_versions').select('receipt_id, version_no, content_hash, state, data, fetched_at').eq('source', source).in('receipt_id', c).order('version_no', { ascending: false }); });
    rows.forEach(function (r) { if (!out[r.receipt_id] || out[r.receipt_id].version_no < r.version_no) { out[r.receipt_id] = r; } });
  }
  return out;
}
// what is hashed: the receipt exactly as received through the allowlists (logs + items sorted by id), never the fetch time
export function receiptHash(rec) { return sha({ r: Object.assign({}, rec, { read_complete: undefined }) }); }

// store what came back: a new version only when the content changed; "removed" only on an authoritative not-found
async function storeAnswer(db, runId, ans) {
  var counts = { stored_new_versions: 0, unchanged: 0, incomplete: 0, removed: 0 };
  var ids = ans.receipts.map(function (r) { return r.id; }).concat(ans.not_found_ids || []);
  var latest = await latestVersions(db, ans.source, ids);
  var rows = []; var seen = [];
  ans.receipts.forEach(function (rec) {
    if (!rec.read_complete) { counts.incomplete++; return; } // never stored as evidence, never counted as verified
    var h = receiptHash(rec); var old = latest[rec.id];
    seen.push({ fetch_run_id: runId, source: ans.source, receipt_id: rec.id, content_hash: h }); // read whole now = verified now (Codex 11:30)
    if (old && old.state === 'present' && old.content_hash === h) { counts.unchanged++; return; }
    rows.push({ source: ans.source, receipt_id: rec.id, version_no: old ? old.version_no + 1 : 1, content_hash: h, state: 'present', data: rec, fetch_run_id: runId, refs: rec.refs || [] });
    counts.stored_new_versions++;
  });
  (ans.not_found_ids || []).forEach(function (id) {
    seen.push({ fetch_run_id: runId, source: ans.source, receipt_id: id, content_hash: 'removed' });
    var old = latest[id]; if (!old || old.state === 'removed') { return; }
    rows.push({ source: ans.source, receipt_id: id, version_no: old.version_no + 1, content_hash: 'removed', state: 'removed', data: { id: id, source: ans.source, state: 'removed' }, fetch_run_id: runId, refs: [] });
    counts.removed++;
  });
  var L_c = chunks(rows, 50); for (var i_c = 0; i_c < L_c.length; i_c++) { var c = L_c[i_c]; var ins = await db.from('wc_receipt_versions').insert(c); if (ins.error) { throw new Error(ins.error.message); } }
  var L_s = chunks(seen, 200); for (var i_s = 0; i_s < L_s.length; i_s++) { var sIns = await db.from('wc_receipt_seen').insert(L_s[i_s]); if (sIns.error) { throw new Error(sIns.error.message); } }
  return counts;
}

// Recheck: look up the receipts linked to these bills (by id — authoritative) and every bill reference (by reference).
// Returns { ok, run_id, error, counts }. A failure keeps the earlier copy untouched.
export async function recheckWarehouse(db, env, userId, trigger, bills, linkRows, fetchImpl) {
  var ids = {}; (linkRows || []).forEach(function (l) { ids[String(l.receipt_id)] = true; });
  var refs = {}; (bills || []).forEach(function (b) { billReferences(b).forEach(function (r) { refs[r.norm] = true; }); });
  var idList = Object.keys(ids); var refList = Object.keys(refs);
  var probe = await fetchReceipts(env, { refs: [] }, fetchImpl); // checks the address / token set-up only (no request)
  var source = probe.source || 'unknown';
  var runId = await startRun(db, trigger, userId, source);
  var counts = { asked_ids: idList.length, asked_refs: refList.length, stored_new_versions: 0, unchanged: 0, incomplete: 0, removed: 0, receipts: 0 };
  var lookups = null; var generated = null; var site = null; var complete = true; var errors = [];
  var searches = [];
  try {
    if (probe.ok === false) { throw new Error(probe.error); }
    var parts = chunks(idList, MAX_IDS).map(function (c) { return { ids: c }; }).concat(chunks(refList, MAX_REFS).map(function (c) { return { refs: c }; }));
    var L_p = parts; for (var i_p = 0; i_p < L_p.length; i_p++) { var p = L_p[i_p];
      var ans = await fetchReceipts(env, p, fetchImpl);
      if (!ans.ok) { throw new Error(ans.error || 'Warehouse unavailable / not checked'); }
      site = ans.site; generated = ans.generated_at || generated; lookups = mergeLookups(lookups, ans.lookups);
      if (!ans.complete) { complete = false; }
      var c = await storeAnswer(db, runId, ans);
      Object.keys(c).forEach(function (k) { counts[k] += c[k]; }); counts.receipts += ans.receipts.length;
      if (p.refs && ans.complete) { // a reference search counts only when the whole answer came back
        p.refs.forEach(function (ref) { searches.push({ fetch_run_id: runId, source: ans.source, ref_norm: ref, found: ans.receipts.filter(function (r) { return (r.refs || []).indexOf(ref) >= 0; }).length }); });
      }
    }
    var L_sc = chunks(searches, 200); for (var i_sc = 0; i_sc < L_sc.length; i_sc++) { var sc = L_sc[i_sc]; var si = await db.from('wc_ref_searches').insert(sc); if (si.error) { throw new Error(si.error.message); } }
    await finishRun(db, runId, { ok: true, complete: complete, site: site, feed_generated_at: generated, counts: counts, lookups: lookups });
    return { ok: true, run_id: runId, complete: complete, counts: counts, source: source };
  } catch (e) {
    errors.push((e && e.message) || 'unexpected error');
    await finishRun(db, runId, { ok: false, complete: false, error: errors.join(' · ').substring(0, 1000), counts: counts, site: site });
    return { ok: false, run_id: runId, error: errors.join(' · '), counts: counts, source: source };
  }
}
function mergeLookups(a, b) { var out = a || {}; Object.keys(b || {}).forEach(function (t) { out[t] = Object.assign({}, out[t] || {}, b[t]); }); return out; }

export async function lastRun(db) {
  var r = await db.from('wc_fetch_runs').select('id, started_at, finished_at, ok, complete, error, source, site, feed_generated_at, lookups').order('started_at', { ascending: false }).limit(10);
  if (r.error) { throw new Error(r.error.message); }
  var rows = r.data || [];
  return { last: rows[0] || null, lastGood: rows.filter(function (x) { return x.ok === true; })[0] || null };
}

// ---------------------------------------------------------------- assemble the comparison for some bills
// focusIds = the bills asked about. Everything connected to them (other bills and receipts of their groups) is pulled in,
// so a group is always compared whole (Codex 10:16 point 2). floor = the viewer's history window (null = all).
export async function assemble(db, focusIds, floor, opts) {
  var o = opts || {};
  var source = o.source || 'nextrade-staging';
  // 1. links, expanded to whole groups
  var linkRows = []; var billSeen = {}; var recSeen = {}; var billQ = focusIds.slice(); var recQ = [];
  for (var guard = 0; guard < 12 && (billQ.length || recQ.length); guard++) {
    var nb = billQ.filter(function (id) { return !billSeen[id]; }); nb.forEach(function (id) { billSeen[id] = true; });
    var nr = recQ.filter(function (k) { return !recSeen[k]; }); nr.forEach(function (k) { recSeen[k] = true; });
    billQ = []; recQ = [];
    var got = [];
    var L_c1 = chunks(nb, 200); for (var i_c1 = 0; i_c1 < L_c1.length; i_c1++) { var c1 = L_c1[i_c1]; got = got.concat(await all(function () { return db.from('wc_links').select('*').in('bill_id', c1); })); }
    var L_c2 = chunks(nr, 200); for (var i_c2 = 0; i_c2 < L_c2.length; i_c2++) { var c2 = L_c2[i_c2]; got = got.concat(await all(function () { return db.from('wc_links').select('*').eq('source', source).in('receipt_id', c2.map(function (k) { return k.split(':').slice(1).join(':'); })); })); }
    got.forEach(function (l) { if (!linkRows.some(function (x) { return x.id === l.id; })) { linkRows.push(l); } });
    currentLinks(got).forEach(function (l) { var rk = l.source + ':' + l.receipt_id; if (!recSeen[rk]) { recQ.push(rk); } if (!billSeen[l.bill_id]) { billQ.push(l.bill_id); } });
  }
  var links = currentLinks(linkRows);
  var groups = buildGroups(links);
  // 2. bills (visible ones get their lines; hidden ones make their group "limited access")
  var allBillIds = Object.keys(billSeen);
  var bills = {};
  var L_c3 = chunks(allBillIds, 200); for (var i_c3 = 0; i_c3 < L_c3.length; i_c3++) { var c3 = L_c3[i_c3]; (await all(function () { return db.from('vendor_bills').select(BILL_COLS).in('id', c3); })).forEach(function (b) { bills[b.id] = b; }); }
  var hidden = {}; allBillIds.forEach(function (id) { if (!billAllowed(bills[id], floor)) { hidden[id] = true; } });
  var visibleIds = allBillIds.filter(function (id) { return !hidden[id]; });
  var linesByBill = {};
  var L_c4 = chunks(visibleIds, 200); for (var i_c4 = 0; i_c4 < L_c4.length; i_c4++) { var c4 = L_c4[i_c4]; (await all(function () { return db.from('vendor_bill_lines').select('id, bill_id, line_no, line_kind, description, item_key, qty, unit').in('bill_id', c4).order('line_no', { ascending: true }); })).forEach(function (l) { (linesByBill[l.bill_id] = linesByBill[l.bill_id] || []).push(l); }); }
  // 3. receipts (latest stored versions), maps, tolerance
  var recIds = {}; links.forEach(function (l) { recIds[String(l.receipt_id)] = true; });
  var focusRefs = {}; focusIds.forEach(function (id) { if (bills[id] && !hidden[id]) { billReferences(bills[id]).forEach(function (r) { focusRefs[r.norm] = true; }); } });
  var cand = {};
  var refList = Object.keys(focusRefs);
  var L_c5 = chunks(refList, 100); for (var i_c5 = 0; i_c5 < L_c5.length; i_c5++) { var c5 = L_c5[i_c5];
    (await all(function () { return db.from('wc_receipt_versions').select('receipt_id').eq('source', source).overlaps('refs', c5); })).forEach(function (r) { cand[r.receipt_id] = true; });
  }
  var latest = await latestVersions(db, source, Object.keys(recIds).concat(Object.keys(cand)));
  var receipts = {}; var versions = {};
  Object.keys(latest).forEach(function (id) { var v = latest[id]; var d = Object.assign({}, v.data || {}, { source: source, id: id, state: v.state }); receipts[source + ':' + id] = d; versions[source + ':' + id] = { version_no: v.version_no, content_hash: v.content_hash, fetched_at: v.fetched_at }; });
  // last time each receipt was read WHOLE and successfully (Codex 11:30: freshness is apart from approval)
  var seenAt = {}; var seenIds = Object.keys(latest);
  var L_c8 = chunks(seenIds, 200); for (var i_c8 = 0; i_c8 < L_c8.length; i_c8++) { var c8 = L_c8[i_c8]; (await all(function () { return db.from('wc_receipt_seen').select('receipt_id, at').eq('source', source).in('receipt_id', c8).order('at', { ascending: false }); })).forEach(function (s) { if (!seenAt[s.receipt_id] || s.at > seenAt[s.receipt_id]) { seenAt[s.receipt_id] = s.at; } }); }
  Object.keys(versions).forEach(function (k) { var id = k.split(':').slice(1).join(':'); versions[k].last_verified_at = seenAt[id] || versions[k].fetched_at || null; });
  var searches = {};
  var L_c6 = chunks(refList, 100); for (var i_c6 = 0; i_c6 < L_c6.length; i_c6++) { var c6 = L_c6[i_c6]; (await all(function () { return db.from('wc_ref_searches').select('ref_norm, found, at').eq('source', source).in('ref_norm', c6).order('at', { ascending: false }); })).forEach(function (s) { if (!searches[s.ref_norm]) { searches[s.ref_norm] = s; } }); }
  var maps = await all(function () { return db.from('wc_product_maps').select('*'); });
  maps = latestMaps(maps);
  var tolR = await db.from('wc_tolerances').select('*').order('version', { ascending: false }).limit(1);
  if (tolR.error) { throw new Error(tolR.error.message); }
  var tolerance = (tolR.data || [])[0] || null;
  var lookups = (o.lookups) || {};
  // 4. compare
  var items = [];
  groups.forEach(function (g) {
    if (!g.bill_ids.some(function (id) { return focusIds.indexOf(id) >= 0; }) && !o.allGroups) { return; }
    compareGroup({ group: g, bills: bills, linesByBill: linesByBill, receipts: receipts, maps: maps, tolerance: tolerance, lookups: lookups, hiddenBillIds: hidden }).forEach(function (it) {
      it.receipt_versions = (it.receipt_keys || []).map(function (k) { return Object.assign({ key: k }, versions[k] || {}); });
      // the oldest "last verified" of its receipts = how fresh this comparison is (null = never read whole)
      var lv = it.receipt_versions.map(function (v) { return v.last_verified_at || null; });
      it.last_verified_at = lv.length && lv.every(Boolean) ? lv.slice().sort()[0] : null;
      it.links = g.links.map(linkOut); items.push(it);
    });
  });
  var linkedBill = {}; links.forEach(function (l) { linkedBill[l.bill_id] = true; });
  var rejected = {}; linkRows.forEach(function (l) { if (l.state === 'rejected') { var last = latestLinkFor(linkRows, l.bill_id, l.source, l.receipt_id); if (last && last.state === 'rejected') { (rejected[l.bill_id] = rejected[l.bill_id] || {})[l.source + ':' + l.receipt_id] = true; } } });
  focusIds.forEach(function (id) {
    var b = bills[id]; if (!b || hidden[id] || linkedBill[id]) { return; }
    var refs = billReferences(b);
    var searched = refs.length > 0 && refs.every(function (r) { return !!searches[r.norm]; });
    var pool = Object.keys(receipts).map(function (k) { return receipts[k]; }).filter(function (r) { return !(rejected[id] || {})[r.source + ':' + r.id]; });
    var prop = proposeLinks(b, pool);
    var it = unlinkedBillItem(b, prop, refs.length === 0 ? true : searched || prop.candidates.length > 0);
    var previews = [];
    // Max 25 Nov: show the comparison straight away against the ONE receipt that carries this bill's reference. It is a PREVIEW:
    // nothing about it can be decided until a person confirms that receipt (the link rule stays); "Approved" on the Invoices card
    // does exactly that first. Ambiguous references (2+ receipts) get no preview — a person chooses.
    if (prop.candidates.length === 1 && !prop.ambiguous && receipts[prop.candidates[0].receipt_key]) {
      var c0 = prop.candidates[0];
      var pg = { key: 'p:' + id + '|' + c0.receipt_key, bill_ids: [id], receipt_keys: [c0.receipt_key], links: [] };
      compareGroup({ group: pg, bills: bills, linesByBill: linesByBill, receipts: receipts, maps: maps, tolerance: tolerance, lookups: lookups, hiddenBillIds: hidden }).forEach(function (pi) {
        pi.item_key = 'preview|' + pi.item_key; pi.preview = true; pi.proposed_receipt = c0;
        pi.receipt_versions = [Object.assign({ key: c0.receipt_key }, versions[c0.receipt_key] || {})];
        pi.last_verified_at = pi.receipt_versions[0].last_verified_at || null; pi.links = [];
        previews.push(pi);
      });
      it.preview_available = true;
    }
    it.searched_at = refs.map(function (r) { return searches[r.norm] ? { ref: r.raw, basis: r.basis, at: searches[r.norm].at, found: searches[r.norm].found } : { ref: r.raw, basis: r.basis, at: null }; });
    items.push(it);
    previews.forEach(function (pi) { items.push(pi); });
  });
  // 5. decisions, fingerprints, states
  var keys = items.map(function (i) { return i.item_key; });
  var decs = [];
  var L_c7 = chunks(keys, 200); for (var i_c7 = 0; i_c7 < L_c7.length; i_c7++) { var c7 = L_c7[i_c7]; decs = decs.concat(await all(function () { return db.from('wc_decisions').select('id, item_key, kind, reason, evidence, assignee, ticket_id, actor, at, comparison_fp, evidence_hash, outcome, snapshot').in('item_key', c7); })); }
  var byKey = {}; decs.forEach(function (d) { (byKey[d.item_key] = byKey[d.item_key] || []).push(d); });
  items.forEach(function (it) {
    it.comparison_fp = it.inputs ? sha(it.inputs) : null;
    it.needs_decision = needsDecision(it);       // can a person decide it NOW
    it.needs_attention = needsAttention(it);     // does it keep a report open until it is decided (Codex 11:12 P1)
    var st = decisionState(byKey[it.item_key] || [], it.comparison_fp);
    // not checked / limited / mapping conflict: never "done", whatever was decided before (the old decision stays in the history)
    it.state = blockedState(it.outcome) || (it.needs_decision ? st.state : 'not_applicable');
    it.decision = st.decision ? publicDecision(st.decision) : null;
    it.issue = st.issue ? publicDecision(st.issue) : null;
    it.history = st.history.map(publicDecision);
    it.changed = st.changed ? diffInputs(st.decision && st.decision.snapshot && st.decision.snapshot.inputs, it.inputs) : null;
    it.outstanding = it.needs_attention && isOutstanding(it.state);
    it.outcome_words = OUTCOME_WORDS[it.outcome] || it.outcome;
    it.state_words = STATE_WORDS[it.state] || '';
    // a preview is information only: never decided, never counted (the bill's own "confirm the receipt" item stays outstanding)
    if (it.preview) { it.needs_decision = false; it.needs_attention = false; it.outstanding = false; it.state = 'awaiting_link'; it.state_words = 'receipt not confirmed yet'; it.decision = null; it.issue = null; it.history = []; it.changed = null; }
  });
  return { items: items, bills: bills, hidden: hidden, tolerance: tolerance, maps: maps, receipts: receipts, linkRows: linkRows, links: links };
}
function publicDecision(d) { return { id: d.id, kind: d.kind, reason: d.reason, evidence: d.evidence || [], assignee: d.assignee || null, ticket_id: d.ticket_id || null, actor: d.actor, at: d.at, outcome: d.outcome || null }; }
function linkOut(l) { return { bill_id: l.bill_id, receipt_key: l.source + ':' + l.receipt_id, basis: l.basis, basis_words: BASIS_LABEL[l.basis] || l.basis, bill_value: l.bill_value, receipt_value: l.receipt_value, at: l.at, actor: l.actor }; }
function latestLinkFor(rows, billId, source, rid) { return rows.filter(function (l) { return l.bill_id === billId && l.source === source && String(l.receipt_id) === String(rid); }).sort(function (a, b) { return String(a.at).localeCompare(String(b.at)); }).pop(); }
// latest version of each mapping family; retired ones stay out
export function latestMaps(rows) {
  var by = {}; (rows || []).forEach(function (m) { if (!by[m.family] || by[m.family].version < m.version) { by[m.family] = m; } });
  return Object.keys(by).map(function (k) { return by[k]; }).filter(function (m) { return m.state === 'active'; });
}

// the snapshot kept with every decision (Codex: evidence hash over all of it; the comparison fingerprint separately)
export function decisionSnapshot(item, run) {
  return {
    build: WC_BUILD, item_key: item.item_key, outcome: item.outcome, outcome_words: item.outcome_words, reasons: item.reasons || [],
    bill_ids: item.bill_ids || [], receipt_keys: item.receipt_keys || [], receipt_versions: item.receipt_versions || [], links: item.links || [],
    bill_lines: (item.bill_lines || []).map(function (l) { return { bill_id: l.bill_id, bill_number: l.bill_number, line_no: l.line_no, line_id: l.line_id, description: l.description, qty: l.qty, unit: l.unit, conversion: l.conversion, content: sha([l.description, l.qty, l.unit]) }; }),
    scan_rows: (item.scan_rows || []).map(function (s) { return { id: s.id, receipt_key: s.receipt_key, skew: s.skew, pallet: s.pallet, lb: s.lb, yd: s.yd, rolls: s.rolls, pl_kg: s.pl_kg, scanned_out: s.scanned_out }; }),
    figures: item.figures || null, product_label: item.product_label || null, candidates: item.candidates || null,
    inputs: item.inputs || null, comparison_fp: item.comparison_fp || null,
    fetch: run ? { run_id: run.id, finished_at: run.finished_at, source: run.source, site: run.site, feed_generated_at: run.feed_generated_at, complete: run.complete } : null
  };
}
