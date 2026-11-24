// v55.83-YH — Canada historical archive: SERVER-ONLY storage helpers (service-role client passed in).
// Storage: sql/v55-83-YH-canada-history.sql (four canada_history_* tables; the browser cannot reach them).
// This module touches ONLY the canada_history_* tables. It never reads or writes inventory, bills,
// invoices, bank lines or P&L. It never updates or deletes an archive line.
// SWC-safe: var + string concatenation only.
import crypto from 'crypto';
import { ARCHIVE_FORMAT, CANADA_GOODS, validateArchiveFile, releaseKey } from './canada-history';

// The ONE archive file this build accepts: the rows read from Max's workbook 11.23.xlsm
// (sheets "Cambridge Scan In" and "Cambridge Scan Out") on 24 Nov 2026. Any other content is refused.
export var EXPECTED_ARCHIVE_SHA256 = 'b61765f27245bdb0187467a7b68382921de0399f96b33b25e2847ed9098eabfa';
export var SQL_HINT = 'The Canada history needs its tables first: Max runs sql/v55-83-YH-canada-history.sql once in Supabase (it only adds new tables).';

var PAGE = 1000;
var CHUNK = 500;

export function isMissingTable(error) {
  if (!error) { return false; }
  var code = String(error.code || ''); var msg = String(error.message || '');
  return code === 'PGRST205' || code === '42P01' || /could not find the table/i.test(msg) || /does not exist/i.test(msg);
}

async function readAll(db, table, cols, batchId) {
  var out = []; var from = 0; var guard = 0;
  while (guard < 200) {
    var res = await db.from(table).select(cols).eq('batch_id', batchId).order('id', { ascending: true }).range(from, from + PAGE - 1);
    if (res.error) { return { error: res.error }; }
    var rows = res.data || [];
    out = out.concat(rows);
    if (rows.length < PAGE) { break; }
    from += PAGE; guard++;
  }
  return { rows: out };
}

function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }

// Reads the stored archive (the latest COMPLETE load) and the goods-name decisions.
export async function readArchive(db) {
  var b = await db.from('canada_history_batches').select('id, source_file, source_sha256, data_sha256, status, loaded_by, loaded_at, receipt_lines, shipment_lines')
    .eq('status', 'complete').order('loaded_at', { ascending: false }).limit(1);
  if (b.error) { if (isMissingTable(b.error)) { return { ok: true, sql_missing: true, loaded: false }; } return { ok: false, error: 'Could not read the Canada history (' + b.error.message + ').' }; }
  var d = await db.from('canada_history_goods_decisions').select('id, goods_name, cgt_type, decided_by, decided_at').order('decided_at', { ascending: true }).limit(2000);
  if (d.error) { if (isMissingTable(d.error)) { return { ok: true, sql_missing: true, loaded: false }; } return { ok: false, error: 'Could not read the goods-name decisions (' + d.error.message + ').' }; }
  var batch = (b.data || [])[0] || null;
  if (!batch) { return { ok: true, sql_missing: false, loaded: false, decisions: d.data || [] }; }
  var r = await readAll(db, 'canada_history_receipts', 'id, source_row, entry_date, entry_kind, cgt_reference, nexpac_invoice, goods_name, weight_lb', batch.id);
  if (r.error) { return { ok: false, error: 'Could not read the received goods (' + r.error.message + ').' }; }
  var s = await readAll(db, 'canada_history_shipments', 'id, source_row, ship_date, order_date, release_no, nextrade_invoice, customer, goods_name, weight_lb', batch.id);
  if (s.error) { return { ok: false, error: 'Could not read the shipped goods (' + s.error.message + ').' }; }
  // A partly read archive would show wrong totals: refuse it rather than show it.
  if (r.rows.length !== num(batch.receipt_lines) || s.rows.length !== num(batch.shipment_lines)) {
    return { ok: false, error: 'The Canada history did not read completely (' + r.rows.length + ' of ' + batch.receipt_lines + ' received lines, ' + s.rows.length + ' of ' + batch.shipment_lines + ' shipped lines). Nothing is shown; please refresh.' };
  }
  var i;
  for (i = 0; i < r.rows.length; i++) { r.rows[i].weight_lb = num(r.rows[i].weight_lb); }
  for (i = 0; i < s.rows.length; i++) { s.rows[i].weight_lb = num(s.rows[i].weight_lb); }
  return { ok: true, sql_missing: false, loaded: true, batch: batch, receipts: r.rows, shipments: s.rows, decisions: d.data || [] };
}

// v55.83-YK — the KTC invoices the Hub's own books already hold for the archive's Canadian releases.
// READ-ONLY (a select, nothing else) and only ever called for the super admin. Returns just the four fields the
// sales list shows, and only for releases that are in the archive. Voided / archived invoices are left out.
// A read that fails or stops part way returns an error: the screen then shows no dollars rather than part of them.
export async function readKtcInvoicesForReleases(db, shipments) {
  var want = {}; var i;
  var shp = Array.isArray(shipments) ? shipments : [];
  for (i = 0; i < shp.length; i++) { if (shp[i] && shp[i].release_no) { want[releaseKey(shp[i].release_no)] = 1; } }
  var out = []; var from = 0; var guard = 0;
  while (guard < 50) {
    var res = await db.from('accounting_invoices').select('id, release_number, invoice_number, invoice_date, total_amount, record_status')
      .ilike('release_number', '%1001-%').order('id', { ascending: true }).range(from, from + PAGE - 1);
    if (res.error) { return { ok: false, error: 'The KTC invoices could not be read (' + res.error.message + ').' }; }
    var rows = res.data || [];
    for (i = 0; i < rows.length; i++) {
      var st = String(rows[i].record_status == null ? 'active' : rows[i].record_status).toLowerCase();
      if (st !== 'active') { continue; }
      if (!want[releaseKey(rows[i].release_number)]) { continue; }
      out.push({ release_number: rows[i].release_number, invoice_number: rows[i].invoice_number, invoice_date: rows[i].invoice_date, total_amount: num(rows[i].total_amount) });
    }
    if (rows.length < PAGE) { return { ok: true, invoices: out }; }
    from += PAGE; guard++;
  }
  return { ok: false, error: 'The KTC invoices did not read completely.' };
}

export function sha256Text(text) { return crypto.createHash('sha256').update(String(text), 'utf8').digest('hex'); }

// Stores the archive file ONCE. Refused unless the content is exactly the expected file, and
// refused when a complete load already exists. Lines are only ever inserted.
export async function storeArchive(db, text, whoLabel) { return storeArchiveExpecting(db, text, whoLabel, EXPECTED_ARCHIVE_SHA256); }

// The work behind storeArchive. The route only ever calls storeArchive (the fixed fingerprint above);
// this form exists so the tests can run the same code on a small made-up file.
export async function storeArchiveExpecting(db, text, whoLabel, expectedSha) {
  if (typeof text !== 'string' || !text) { return { ok: false, status: 400, error: 'No file content was sent.' }; }
  if (!/^[0-9a-f]{64}$/.test(String(expectedSha || ''))) { return { ok: false, status: 500, error: 'No fingerprint to check the file against. Nothing was stored.' }; }
  var hash = sha256Text(text);
  if (hash !== expectedSha) { return { ok: false, status: 400, error: 'This is not the Canada history file made from the 11.23 workbook (its fingerprint does not match). Nothing was stored.' }; }
  var obj = null;
  try { obj = JSON.parse(text); } catch (eP) { return { ok: false, status: 400, error: 'The file could not be read.' }; }
  var v = validateArchiveFile(obj);
  if (!v.ok) { return { ok: false, status: 400, error: 'The file did not pass its checks: ' + v.errors.join(' ') }; }
  if (obj.format !== ARCHIVE_FORMAT) { return { ok: false, status: 400, error: 'Wrong file type.' }; }

  var ex = await db.from('canada_history_batches').select('id, loaded_at').eq('status', 'complete').limit(1);
  if (ex.error) { if (isMissingTable(ex.error)) { return { ok: false, status: 503, error: SQL_HINT }; } return { ok: false, status: 500, error: 'Could not check the archive (' + ex.error.message + ').' }; }
  if ((ex.data || []).length) { return { ok: false, status: 409, error: 'The Canada history is already stored. It is kept as it is and is not loaded twice.' }; }

  var ins = await db.from('canada_history_batches').insert({ source_file: String(obj.source_file || '').substring(0, 300), source_sha256: String(obj.source_sha256 || '').substring(0, 64),
    data_sha256: hash, status: 'loading', loaded_by: String(whoLabel || '').substring(0, 200), receipt_lines: v.receipts.length, shipment_lines: v.shipments.length }).select('id').single();
  if (ins.error || !ins.data) { return { ok: false, status: 500, error: 'Could not start the load (' + ((ins.error && ins.error.message) || 'no answer') + ').' }; }
  var batchId = ins.data.id;
  var i; var part; var res;
  for (i = 0; i < v.receipts.length; i += CHUNK) {
    part = v.receipts.slice(i, i + CHUNK).map(function (r) {
      return { batch_id: batchId, source_row: r.source_row, entry_date: r.entry_date || null, entry_kind: r.entry_kind, cgt_reference: r.cgt_reference || null,
        nexpac_invoice: r.nexpac_invoice || null, goods_name: r.goods_name, weight_lb: r.weight_lb };
    });
    res = await db.from('canada_history_receipts').insert(part);
    if (res.error) { return { ok: false, status: 500, error: 'The load stopped part way (received goods: ' + res.error.message + '). The partial load is ignored and nothing is shown from it; you can load again.' }; }
  }
  for (i = 0; i < v.shipments.length; i += CHUNK) {
    part = v.shipments.slice(i, i + CHUNK).map(function (r) {
      return { batch_id: batchId, source_row: r.source_row, ship_date: r.ship_date, order_date: r.order_date || null, release_no: r.release_no,
        nextrade_invoice: r.nextrade_invoice || null, customer: r.customer || null, goods_name: r.goods_name, weight_lb: r.weight_lb };
    });
    res = await db.from('canada_history_shipments').insert(part);
    if (res.error) { return { ok: false, status: 500, error: 'The load stopped part way (shipped goods: ' + res.error.message + '). The partial load is ignored and nothing is shown from it; you can load again.' }; }
  }
  var fin = await db.from('canada_history_batches').update({ status: 'complete' }).eq('id', batchId).eq('status', 'loading').select('id');
  if (fin.error || !(fin.data || []).length) { return { ok: false, status: 500, error: 'The lines were stored but the load could not be marked complete (' + ((fin.error && fin.error.message) || 'no row') + '). Nothing is shown from it; you can load again.' }; }
  return { ok: true, batch_id: batchId, receipt_lines: v.receipts.length, shipment_lines: v.shipments.length };
}

// Records Max's decision for one old Canadian goods name. Append-only: an earlier decision is
// kept; the latest one is the one in force. cgtType '' = keep it unmatched under its own name.
export async function saveGoodsDecision(db, goodsName, cgtType, whoLabel) {
  var g = String(goodsName == null ? '' : goodsName);
  if (CANADA_GOODS.indexOf(g) < 0) { return { ok: false, status: 400, error: 'Unknown Canadian goods name.' }; }
  var t = String(cgtType == null ? '' : cgtType).replace(/[\u0000-\u001f]+/g, ' ').trim().substring(0, 80);
  var res = await db.from('canada_history_goods_decisions').insert({ goods_name: g, cgt_type: t, decided_by: String(whoLabel || '').substring(0, 200) }).select('id').single();
  if (res.error) { if (isMissingTable(res.error)) { return { ok: false, status: 503, error: SQL_HINT }; } return { ok: false, status: 500, error: 'Could not save the decision (' + res.error.message + ').' }; }
  return { ok: true, goods_name: g, cgt_type: t };
}
