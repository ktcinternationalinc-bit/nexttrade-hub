// v55.83-YH — CANADA HISTORICAL ARCHIVE (Max, 24 Nov 2026).
//
// Max: "save this historical data on the canada side for historical purposes on the amounts of goods received for the
// different types of goods. correlate it to the current types of cgt goods ... create its own menu tab."
//
// A PRIVATE, READ-ONLY archive of the old Cambridge (Ontario) workbook: goods received and goods shipped, in pounds, by
// goods type and month. Rules: lib/canada-history.js. Storage: lib/canada-history-server.js + sql/v55-83-YH-canada-history.sql.
//
// What this route NEVER does: read or change inventory, bills, invoices, bank lines, P&L, Wave or the warehouse.
// It reads and writes ONLY the canada_history_* tables, and an archive line is never updated or deleted.
//
// Identity: the verified sign-in (bearer), never a user_id from the body.
//   GET                see the archive   — super admin, or a person Max switched on ('canada_history.access').
//                      PRIVATE: a role (owner / admin) never opens it by itself, only the explicit switch.
//   POST action=load   store the archive file once (fingerprint-checked) — SUPER ADMIN ONLY
//   POST action=map    decide which current CGT goods type an old Canadian name belongs to — SUPER ADMIN ONLY
// SWC-safe: var + string concatenation only.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifiedCaller } from '../../../lib/verified-caller';
import { loadUserPermissions } from '../../../lib/server-permissions';
import { readArchive, storeArchive, saveGoodsDecision, SQL_HINT } from '../../../lib/canada-history-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

var API_BUILD_MARKER = 'v55.83-YH-canada-history';
var PERM = 'canada_history.access';
var MAX_FILE_CHARS = 2000000;

function admin() { return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY); }
function out(body, status) { return NextResponse.json(Object.assign({ api_build_marker: API_BUILD_MARKER }, body), { status: status || 200 }); }
function bad(msg, status) { return out({ ok: false, error: msg }, status || 400); }

// Fails closed: super admin, or the explicit switch ON (and not switched OFF). Never a role default.
async function access(db, userId) {
  if (!userId) { return { ok: false, isSuper: false }; }
  var ctx = await loadUserPermissions(db, userId);
  if (ctx && ctx.isSuperAdmin === true) { return { ok: true, isSuper: true }; }
  if (ctx && ctx.mp && ctx.mp[PERM] === true && !(ctx.deny && ctx.deny[PERM] === true)) { return { ok: true, isSuper: false }; }
  return { ok: false, isSuper: false };
}

async function whoLabel(db, userId) {
  try {
    var u = await db.from('users').select('id, email').eq('id', userId).limit(1);
    var row = u && u.data && u.data[0];
    if (row && row.email) { return String(row.email); }
  } catch (eU) { /* fall through to the id */ }
  return String(userId || '');
}

export async function GET(request) {
  var db = admin();
  var who = await verifiedCaller(request, {}, createClient);
  if (who.error) { return bad(who.error, who.status || 401); }
  var gate = await access(db, who.userId);
  if (!gate.ok) { return bad('You do not have access to the Canada history.', 403); }
  var isSuper = gate.isSuper;
  try {
    var a = await readArchive(db);
    if (!a.ok) { return bad(a.error, 500); }
    if (a.sql_missing) { return out({ ok: true, sql_missing: true, sql_hint: SQL_HINT, loaded: false, can_manage: isSuper, receipts: [], shipments: [], decisions: [] }); }
    return out({ ok: true, sql_missing: false, loaded: a.loaded === true, can_manage: isSuper, batch: a.batch || null,
      receipts: a.receipts || [], shipments: a.shipments || [], decisions: a.decisions || [] });
  } catch (e) {
    return bad('The Canada history could not be read right now.', 500);
  }
}

export async function POST(request) {
  var body = null;
  try { body = await request.json(); } catch (eB) { return bad('The request was not readable.'); }
  body = body || {};
  var who = await verifiedCaller(request, body, createClient);
  if (who.error) { return bad(who.error, who.status || 401); }
  var db = admin();
  var gate = await access(db, who.userId);
  if (!gate.ok) { return bad('You do not have access to the Canada history.', 403); }
  var isSuper = gate.isSuper;
  // Storing the archive and deciding the goods names are Max's alone.
  if (!isSuper) { return bad('Only the super admin can change the Canada history.', 403); }
  var action = String(body.action || '');
  try {
    var label = await whoLabel(db, who.userId);
    if (action === 'load') {
      var text = body.file_text;
      if (typeof text !== 'string' || !text) { return bad('No file content was sent.'); }
      if (text.length > MAX_FILE_CHARS) { return bad('The file is too large to be the Canada history file.'); }
      var s = await storeArchive(db, text, label);
      if (!s.ok) { return bad(s.error, s.status || 400); }
      return out({ ok: true, receipt_lines: s.receipt_lines, shipment_lines: s.shipment_lines });
    }
    if (action === 'map') {
      var m = await saveGoodsDecision(db, body.goods_name, body.cgt_type, label);
      if (!m.ok) { return bad(m.error, m.status || 400); }
      return out({ ok: true, goods_name: m.goods_name, cgt_type: m.cgt_type });
    }
    return bad('Unknown action.');
  } catch (e) {
    return bad('The Canada history could not be changed right now.', 500);
  }
}
