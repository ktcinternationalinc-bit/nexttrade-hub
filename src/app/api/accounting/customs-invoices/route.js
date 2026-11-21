// /api/accounting/customs-invoices — v55.83-XD (Max, 21 Nov 2026: "an abiltiy to create a custom invoice that has no bearing on
// amount due or tax implications or is even part of any data. Just an invoice creted for customer for customs purposes with ZEROR
// implications on any underlying reported data. just saved under te original invoice like a proforma invoice").
// ONE server route for the customs invoices saved under a customer invoice:
//  • WHO: the verified signed-in person (verifiedCaller), never a user id from the browser.
//  • READ (list / get): the Invoices view switch (or Invoice Create / Edit). WRITE (create / save / void): Invoice Create or
//    Invoice Edit (Max 21 Nov: "Invoice Create / Edit").
//  • The history window (Max's rule): the invoice's date saved when the customs paper was made, AND the invoice's date today while
//    it still exists, must both be inside the person's window — on every action, by id too.
//  • READS accounting_invoices (one invoice: its snapshot and window check). WRITES ONLY the customs tables (through the three locked
//    database steps hub_customs_invoice_create / _save / _void) and the audit log. Nothing here touches an invoice, its lines, its
//    payments, Wave, reminders, numbering or any report.
//  • A version is never changed: every save is a new version, refused if someone saved a newer one meanwhile. Nothing is deleted.
// SWC-safe: var + string concatenation.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifiedCaller } from '../../../../lib/verified-caller';
import { loadUserPermissions, userHasPermission } from '../../../../lib/server-permissions';
import { windowFloorFor } from '../../../../lib/visibility-window-server';
import { audit } from '../../../../lib/audit-server';
import { CUSTOMS_SQL_MISSING, isUuid, cleanDoc, customsVisible, customsLabel, stepError } from '../../../../lib/customs-invoice';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

var DOCS = 'accounting_customs_invoices';
var VERS = 'accounting_customs_invoice_versions';
var ID_COLS = 'id, invoice_id, seq, invoice_number_at_creation, invoice_date_at_creation, accounting_customer_id, business_id, wave_business_id, created_by_name, created_at, voided_at, voided_by_name, void_reason';
var VER_SUMMARY = 'id, customs_invoice_id, version, total, currency, note, saved_by_name, saved_at';
var INV_COLS = 'id, invoice_number, invoice_date, accounting_customer_id, business_id, wave_business_id, record_status';
var READ_ACTIONS = { list: 1, get: 1 };
var WRITE_ACTIONS = { create: 1, save: 1, void: 1 };
var OUTSIDE = 'That invoice is older than the history you are allowed to see.';

function admin() { return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } }); }
function fail(msg, st, extra) { return NextResponse.json(Object.assign({ ok: false, error: msg }, extra || {}), { status: st || 400 }); }
function tableMissing(err) {
  var m = String((err && err.message) || '');
  return (m.indexOf(DOCS) >= 0 || m.indexOf(VERS) >= 0) && /does not exist|Could not find|schema cache/i.test(m);
}
function mayRead(ctx) { return userHasPermission(ctx, 'invoices.view') || userHasPermission(ctx, 'invoices.create') || userHasPermission(ctx, 'invoices.edit'); }
function mayWrite(ctx) { return userHasPermission(ctx, 'invoices.create') || userHasPermission(ctx, 'invoices.edit'); }
function idOut(r) {
  return { id: r.id, invoice_id: r.invoice_id, seq: r.seq, label: customsLabel(r.seq), invoice_number_at_creation: r.invoice_number_at_creation || null,
    invoice_date_at_creation: r.invoice_date_at_creation || null, created_by_name: r.created_by_name || null, created_at: r.created_at || null,
    voided: !!r.voided_at, voided_at: r.voided_at || null, voided_by_name: r.voided_by_name || null, void_reason: r.void_reason || null };
}
function verOut(v, withDoc) {
  var o = { id: v.id, version: Number(v.version), total: v.total === null || v.total === undefined ? null : Number(v.total), currency: v.currency || null,
    note: v.note || null, saved_by_name: v.saved_by_name || null, saved_at: v.saved_at || null };
  if (withDoc) { o.doc = v.doc || null; }
  return o;
}

async function invoiceRow(db, id) {
  var r = await db.from('accounting_invoices').select(INV_COLS).eq('id', id).maybeSingle();
  if (r.error) { throw new Error(r.error.message); }
  return r.data || null;
}
async function personName(db, userId) {
  try { var u = await db.from('users').select('id, name, email').eq('id', userId).maybeSingle(); return (u && u.data && (u.data.name || u.data.email)) || null; }
  catch (e) { return null; }
}
// one customs paper by id + the person may see it? → { row, inv } or { res: <refusal> }
async function loadVisible(db, id, floor) {
  var r = await db.from(DOCS).select(ID_COLS).eq('id', id).maybeSingle();
  if (r.error) { return { res: tableMissing(r.error) ? fail(CUSTOMS_SQL_MISSING, 409, { code: 'not_installed' }) : fail('Could not look it up (' + r.error.message + ').', 500) }; }
  if (!r.data) { return { res: fail('That customs invoice is not on record — refresh.', 404) }; }
  var inv = await invoiceRow(db, r.data.invoice_id);
  if (!customsVisible(r.data, inv, floor)) { return { res: fail(OUTSIDE, 403) }; }
  return { row: r.data, inv: inv };
}

export async function POST(req) {
  var body = null;
  try { body = await req.json(); } catch (eB) { return fail('The request could not be read.'); }
  var who = await verifiedCaller(req, body, createClient);
  if (who.error) { return fail(who.error, who.status || 401); }
  var userId = who.userId;
  var action = String((body && body.action) || '');
  if (!READ_ACTIONS[action] && !WRITE_ACTIONS[action]) { return fail('Unknown action.'); }
  var db = admin();
  try {
    var ctx = await loadUserPermissions(db, userId);
    if (!mayRead(ctx)) { return fail('You need the Invoices: View switch to see customs invoices. Ask the super admin.', 403); }
    var canEdit = mayWrite(ctx);
    if (WRITE_ACTIONS[action] && !canEdit) { return fail('You need the Invoice: Create or Invoice: Edit switch for that. Ask the super admin.', 403); }
    var win = await windowFloorFor(db, ctx);
    if (win.error) { return fail(win.error, 503); }
    var floor = win.floor || null;

    // ── list: the customs papers saved under one invoice (newest version of each)
    if (action === 'list') {
      var lid = String(body.invoice_id || '');
      if (!isUuid(lid)) { return fail('Which invoice?'); }
      var linv = await invoiceRow(db, lid);
      if (linv && !customsVisible({ invoice_date_at_creation: linv.invoice_date }, linv, floor)) { return fail(OUTSIDE, 403); }
      var lr = await db.from(DOCS).select(ID_COLS).eq('invoice_id', lid).order('seq', { ascending: true });
      if (lr.error) { if (tableMissing(lr.error)) { return NextResponse.json({ ok: true, installed: false, can_edit: canEdit, items: [] }); } throw new Error(lr.error.message); }
      var rows = (lr.data || []).filter(function (r) { return customsVisible(r, linv, floor); });
      var newest = {};
      if (rows.length) {
        var vr = await db.from(VERS).select(VER_SUMMARY).in('customs_invoice_id', rows.map(function (r) { return r.id; }));
        if (vr.error) { if (tableMissing(vr.error)) { return NextResponse.json({ ok: true, installed: false, can_edit: canEdit, items: [] }); } throw new Error(vr.error.message); }
        (vr.data || []).forEach(function (v) { var k = v.customs_invoice_id; if (!newest[k] || Number(v.version) > Number(newest[k].version)) { newest[k] = v; } });
      }
      var items = rows.map(function (r) { return Object.assign(idOut(r), { newest: newest[r.id] ? verOut(newest[r.id], false) : null }); });
      return NextResponse.json({ ok: true, installed: true, can_edit: canEdit, items: items });
    }

    // ── get: one customs paper and EVERY version (with what each one says)
    if (action === 'get') {
      var gid = String(body.id || '');
      if (!isUuid(gid)) { return fail('Which customs invoice?'); }
      var g = await loadVisible(db, gid, floor);
      if (g.res) { return g.res; }
      var gv = await db.from(VERS).select(VER_SUMMARY + ', doc').eq('customs_invoice_id', gid).order('version', { ascending: false });
      if (gv.error) { return tableMissing(gv.error) ? fail(CUSTOMS_SQL_MISSING, 409, { code: 'not_installed' }) : fail('Could not read the versions (' + gv.error.message + ').', 500); }
      return NextResponse.json({ ok: true, can_edit: canEdit, customs: idOut(g.row), invoice_exists: !!g.inv, versions: (gv.data || []).map(function (v) { return verOut(v, true); }) });
    }

    // ── create: the customs paper + version 1, in ONE database step. The snapshot comes from the real invoice, never from the browser.
    if (action === 'create') {
      var cInvId = String(body.invoice_id || '');
      if (!isUuid(cInvId)) { return fail('Which invoice?'); }
      var cInv = await invoiceRow(db, cInvId);
      if (!cInv) { return fail('That invoice is not there any more — refresh the list.', 404); }
      if (!customsVisible({ invoice_date_at_creation: cInv.invoice_date }, cInv, floor)) { return fail(OUTSIDE, 403); }
      var rs = String(cInv.record_status || 'active');
      if (rs === 'deleted' || rs === 'void' || rs === 'cancelled') { return fail('This invoice is ' + rs + ' — a customs invoice cannot be made under it.', 409); }
      var cc = cleanDoc(body.doc);
      if (!cc.ok) { return fail(cc.error, 400); }
      var cName = await personName(db, userId);
      var cNote = String(body.note || '').trim().substring(0, 300);
      var cr = await db.rpc('hub_customs_invoice_create', { p: { invoice_id: cInv.id, invoice_number: cInv.invoice_number || null, invoice_date: cInv.invoice_date || null,
        accounting_customer_id: cInv.accounting_customer_id || null, business_id: cInv.business_id || null, wave_business_id: cInv.wave_business_id || null,
        doc: cc.doc, total: cc.total, currency: cc.currency, note: cNote, actor_id: userId, actor_name: cName } });
      if (cr.error) { var ce = stepError(cr.error); return fail(ce.msg, ce.status, { code: ce.code }); }
      var made = cr.data || {};
      await audit(db, userId, 'customs_invoice_created', DOCS, made.id || null, { invoice_id: cInv.id, invoice_number: cInv.invoice_number || null, seq: made.seq || null, version: 1, printed_number: cc.doc.printed_number });
      return NextResponse.json({ ok: true, id: made.id, seq: made.seq, version: 1 });
    }

    // ── save: a NEW version on top of the newest one (the database refuses an older base and a voided paper)
    if (action === 'save') {
      var sid = String(body.id || '');
      if (!isUuid(sid)) { return fail('Which customs invoice?'); }
      var base = Number(body.base_version);
      if (!(base >= 1 && Math.floor(base) === base)) { return fail('Which version did you edit? Reload and try again.'); }
      var s = await loadVisible(db, sid, floor);
      if (s.res) { return s.res; }
      if (s.row.voided_at) { return fail('This customs invoice was voided and cannot be edited.', 409, { code: 'voided' }); }
      var sc = cleanDoc(body.doc);
      if (!sc.ok) { return fail(sc.error, 400); }
      var sName = await personName(db, userId);
      var sr = await db.rpc('hub_customs_invoice_save', { p: { customs_invoice_id: sid, base_version: base, doc: sc.doc, total: sc.total, currency: sc.currency,
        note: String(body.note || '').trim().substring(0, 300), actor_id: userId, actor_name: sName } });
      if (sr.error) { var se = stepError(sr.error); return fail(se.msg, se.status, { code: se.code }); }
      var saved = sr.data || {};
      await audit(db, userId, 'customs_invoice_saved', DOCS, sid, { invoice_id: s.row.invoice_id, seq: s.row.seq, version: saved.version || null, printed_number: sc.doc.printed_number });
      return NextResponse.json({ ok: true, id: sid, version: saved.version });
    }

    // ── void: stamped once (who / when / why); it stays on record, every version stays readable
    if (action === 'void') {
      var vid = String(body.id || '');
      if (!isUuid(vid)) { return fail('Which customs invoice?'); }
      var reason = String(body.reason || '').trim().substring(0, 300);
      if (!reason) { return fail('Say why it is voided.'); }
      var v = await loadVisible(db, vid, floor);
      if (v.res) { return v.res; }
      if (v.row.voided_at) { return fail('This customs invoice was already voided.', 409, { code: 'voided' }); }
      var vName = await personName(db, userId);
      var vres = await db.rpc('hub_customs_invoice_void', { p: { customs_invoice_id: vid, reason: reason, actor_id: userId, actor_name: vName } });
      if (vres.error) { var ve = stepError(vres.error); return fail(ve.msg, ve.status, { code: ve.code }); }
      await audit(db, userId, 'customs_invoice_voided', DOCS, vid, { invoice_id: v.row.invoice_id, seq: v.row.seq, reason: reason });
      return NextResponse.json({ ok: true, id: vid });
    }
    return fail('Unknown action.');
  } catch (e) {
    return fail('Something went wrong on the server (' + ((e && e.message) || 'error') + '). Refresh and check before trying again.', 500);
  }
}
