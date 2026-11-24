// v55.83-XB — reads warehouse RECEIPTS (scan-ins) from NextTrade, server-side and read-only. Server-only (no 'use client').
//
// Today the warehouse feed (/api/hub-feed) has NO scan-ins. The plan (Codex 10:16) adds ONE read-only endpoint on the warehouse,
// GET /api/hub-feed/receipts — it exists only after Max names that change. Until then every read here answers
// "Warehouse unavailable / not checked" (the endpoint is missing), never "no goods received".
//
// Rules:
//  • the same approved-address rule and token as the Orders report / shipping sync (warehouseFeedConfig: https, staging domain,
//    live only by exact name + Max's go-ahead); no redirect ever carries the token; the token never reaches the browser;
//  • the answer must say which warehouse copy it is (feedIdentityProblem);
//  • explicit FIELD ALLOWLISTS (Codex 10:16 point 5): only these fields are kept, whatever the warehouse sends — no prices,
//    values, driver names, licence numbers or photo paths;
//  • every receipt must arrive whole: its stated log / item counts must equal the rows received, otherwise it is marked
//    read_complete = false (never used as evidence of a removal, never stored as a version);
//  • a receipt is "removed" ONLY when an id look-up succeeded AND the warehouse listed that id as not found.
// SWC-safe: var + string concatenation.
import { warehouseFeedConfig, feedIdentityProblem } from './warehouse-feed-config';
import { normRef } from './weight-check';

export var MAX_IDS = 100; export var MAX_REFS = 100;
var RECEIPT_FIELDS = ['id', 'reference_number', 'nexpac_bill', 'supplier_id', 'warehouse_id', 'is_draf', 'non_billable', 'is_bonded_order', 'receipt_date', 'updated_at', 'log_count', 'item_count'];
var INFO_FIELDS = ['cgt_reference', 'inbound_control_number', 'bill_of_lading_number', 'container_trailer_number', 'invoice_code', 'broker_reference_number', 'entry_id',
  'declared_quantity', 'declared_roll_count', 'uom', 'inbound_weight_gross', 'has_discrepancy', 'discrepancy_type', 'discrepancy_reason', 'discrepancy_note', 'osd_flag', 'signed_off_at'];
var LOG_FIELDS = ['id', 'scan_in_inventory_id', 'unit', 'skew_number', 'old_skew_number', 'product_type', 'cgt', 'nt', 'color', 'rolls', 'roll_count', 'weight', 'pl_weight', 'yards', 'sqm',
  'pallet_id', 'lot_number', 'batch_number', 'hs_code', 'description', 'is_scan_out', 'created_at', 'updated_at'];
var ITEM_FIELDS = ['id', 'scan_in_logs_id', 'pallet_id', 'roll_count', 'uom', 'pl_weight', 'sqm', 'lot_number', 'batch_number', 'hs_code', 'description'];
var LOOKUP_TABLES = ['product_types', 'cgt_grades', 'nt_grades', 'colors'];

function pick(o, fields) { var out = {}; if (!o || typeof o !== 'object') { return out; } fields.forEach(function (f) { if (Object.prototype.hasOwnProperty.call(o, f)) { var v = o[f]; out[f] = (v !== null && typeof v === 'object') ? null : v; } }); return out; }
function idStr(v) { return v === null || v === undefined ? '' : String(v).trim(); }

// the receipts endpoint lives beside the existing feed. NEXTRADE_FEED_URL is really …/api/hub-feed/shipping (the Orders report and
// the shipping sync read it as-is); …/api/hub-feed also works → …/api/hub-feed/receipts (24 Nov: it used to give …/shipping/receipts)
export function receiptsUrl(feedUrl) {
  var u = new URL(feedUrl); u.search = ''; u.hash = '';
  u.pathname = u.pathname.replace(/\/+$/, '').replace(/\/(shipping|grade-flow|receipts)$/, '') + '/receipts';
  return u.toString();
}

// one answer → normalised receipts, each whole or marked incomplete. Pure (tested without a network).
export function normaliseAnswer(ans, cfg, mode, asked) {
  var idp = feedIdentityProblem(ans, cfg);
  if (idp) { return { ok: false, error: idp }; }
  if (!ans || ans.ok !== true || !Array.isArray(ans.receipts) || !Array.isArray(ans.logs)) { return { ok: false, error: 'The warehouse answered, but not in the expected shape for receipts.' }; }
  var lookups = {};
  LOOKUP_TABLES.forEach(function (t) { var m = {}; var src = ans.lookups && ans.lookups[t]; if (src && typeof src === 'object') { Object.keys(src).forEach(function (k) { var v = src[k]; if (typeof v === 'string' || typeof v === 'number') { m[String(k)] = String(v).substring(0, 120); } }); } lookups[t] = m; });
  var logsBy = {}; ans.logs.forEach(function (l) { var x = pick(l, LOG_FIELDS); var k = idStr(x.scan_in_inventory_id); (logsBy[k] = logsBy[k] || []).push(x); });
  var itemsBy = {}; (Array.isArray(ans.items) ? ans.items : []).forEach(function (it) { var x = pick(it, ITEM_FIELDS); var k = idStr(x.scan_in_logs_id); (itemsBy[k] = itemsBy[k] || []).push(x); });
  var truncatedIds = {}; (Array.isArray(ans.truncated_ids) ? ans.truncated_ids : []).forEach(function (i) { truncatedIds[idStr(i)] = true; });
  var out = [];
  ans.receipts.forEach(function (r0) {
    var r = pick(r0, RECEIPT_FIELDS); var id = idStr(r.id); if (!id) { return; }
    var logs = (logsBy[id] || []).sort(function (a, b) { return Number(a.id) - Number(b.id); });
    var nItems = 0; logs.forEach(function (l) { var its = (itemsBy[idStr(l.id)] || []).sort(function (a, b) { return Number(a.id) - Number(b.id); }); l.items = its; nItems += its.length; });
    var lc = Number(r.log_count); var ic = Number(r.item_count);
    var complete = !truncatedIds[id] && isFinite(lc) && lc === logs.length && (!isFinite(ic) || r.item_count === null || r.item_count === undefined || ic === nItems) && !(ans.truncated === true && !isFinite(lc));
    var info = pick(r0 && r0.info, INFO_FIELDS);
    var sup = r0 && r0.supplier && typeof r0.supplier === 'object' ? { id: idStr(r0.supplier.id) || null, name: r0.supplier.name ? String(r0.supplier.name).substring(0, 160) : null } : null;
    var wh = r0 && r0.warehouse && typeof r0.warehouse === 'object' ? { id: idStr(r0.warehouse.id) || null, name: r0.warehouse.name ? String(r0.warehouse.name).substring(0, 160) : null } : null;
    var rec = Object.assign({}, r, { id: id, source: cfg.source, info: info, supplier: sup, warehouse: wh, logs: logs, state: 'present', read_complete: complete });
    rec.refs = receiptRefs(rec);
    out.push(rec);
  });
  var notFound = [];
  if (mode === 'ids' && Array.isArray(ans.not_found_ids)) {
    var askedSet = {}; (asked || []).forEach(function (i) { askedSet[idStr(i)] = true; });
    ans.not_found_ids.forEach(function (i) { var k = idStr(i); if (askedSet[k]) { notFound.push(k); } }); // only ids we asked for, and only from a successful id look-up
  }
  return { ok: true, source: cfg.source, site: ans.site || cfg.host, generated_at: ans.generated_at || null, receipts: out, not_found_ids: notFound, lookups: lookups,
    complete: ans.truncated !== true && out.every(function (r) { return r.read_complete; }), ref_counts: ans.ref_counts && typeof ans.ref_counts === 'object' ? ans.ref_counts : null };
}
export function receiptRefs(r) {
  var vals = [r.reference_number, r.nexpac_bill, r.info && r.info.cgt_reference, r.info && r.info.container_trailer_number];
  var out = []; vals.forEach(function (v) { var n = normRef(v); if (n && out.indexOf(n) < 0) { out.push(n); } }); return out;
}

// ask the warehouse. q = { ids: [...] } (authoritative look-up) or { refs: [...normalised] }. Never throws.
export async function fetchReceipts(env, q, fetchImpl) {
  var cfg = warehouseFeedConfig(env);
  if (cfg.error) { return { ok: false, unavailable: true, error: cfg.error }; }
  var mode = q && Array.isArray(q.ids) && q.ids.length ? 'ids' : 'refs';
  var list = mode === 'ids' ? q.ids.map(idStr).filter(Boolean) : (q.refs || []).map(normRef).filter(Boolean);
  if (!list.length) { return { ok: true, source: cfg.source, site: cfg.host, receipts: [], not_found_ids: [], lookups: {}, complete: true, generated_at: null }; }
  if (list.length > (mode === 'ids' ? MAX_IDS : MAX_REFS)) { return { ok: false, error: 'Too many receipts asked at once (' + list.length + ').' }; }
  var url; try { url = new URL(receiptsUrl(cfg.url)); } catch (eU) { return { ok: false, unavailable: true, error: 'The warehouse address is not usable.' }; }
  url.searchParams.set(mode, list.join(','));
  var f = fetchImpl || fetch; var ans;
  try {
    var ctl = new AbortController(); var tm = setTimeout(function () { ctl.abort(); }, 40000);
    var res = await f(url.toString(), { headers: { 'X-Hub-Feed-Token': cfg.token, 'Accept': 'application/json' }, signal: ctl.signal, cache: 'no-store', redirect: 'error' });
    clearTimeout(tm);
    if (res.status === 404) { return { ok: false, unavailable: true, not_installed: true, error: 'The warehouse does not offer receipts to the Hub yet (its receipts feed is not installed) — Warehouse unavailable / not checked.' }; }
    if (!res.ok) { return { ok: false, unavailable: true, error: 'The warehouse answered HTTP ' + res.status + (res.status === 401 ? ' (the token was refused)' : '') + ' — Warehouse unavailable / not checked.' }; }
    ans = await res.json();
  } catch (eF) { return { ok: false, unavailable: true, error: 'Could not reach the warehouse (' + ((eF && eF.name === 'AbortError') ? 'no answer within 40 seconds' : 'network error') + ') — Warehouse unavailable / not checked.' }; }
  var n = normaliseAnswer(ans, cfg, mode, list);
  if (!n.ok) { n.unavailable = true; }
  n.mode = mode; n.asked = list;
  return n;
}
