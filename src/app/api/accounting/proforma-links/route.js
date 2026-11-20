// /api/accounting/proforma-links — v55.83-VZ (Max, 20 Nov 2026: "Proforma invoices need to be linked to invoices and that we
// need to upload a signed proforma that is saved and archived with them.")
// ONE server route for: which proforma an invoice came from / which invoices a proforma made, linking and unlinking them, and the
// signed proforma files (versions are added, never replaced, never deleted).
//  • WHO: the verified signed-in person (verifiedCaller), never a user id from the browser.
//  • READ (get / map / file_url): the Invoices view switch (or Create / Edit — the screen's own rule).
//  • WRITE (link / unlink / upload_start / upload_finish): Invoice Create or Invoice Edit — the screen's "may edit".
//  • The history window (Max's rule) applies: a document dated before the person's window is neither opened nor named here.
//  • The two tables and the store "proforma-signed" are closed to browsers (sql/v55-83-VZ-proforma-links-signed.sql); a signed file
//    is reached only through a 5-minute link this route hands out after the checks. The storage path is never sent to a reader.
//  • There is no update or delete of a signed file anywhere in this route. Unlinking stamps the link row; it is not removed.
// Wave and the printed customer invoice are not touched. SWC-safe: var + string concatenation.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import { verifiedCaller } from '../../../../lib/verified-caller';
import { loadUserPermissions, userHasPermission } from '../../../../lib/server-permissions';
import { windowFloorFor } from '../../../../lib/visibility-window-server';
import { audit } from '../../../../lib/audit-server';
import { SIGNED_BUCKET, SIGNED_MAX_BYTES, SIGNED_TYPES, PROFORMA_LINKS_SQL_MISSING, isUuid, sniffSignedFile, safeFileName, signedPathFor, isSignedPathOf, sizeWords, nextVersion, insideWindow, linkProblem } from '../../../../lib/proforma-links';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

var LINKS = 'accounting_proforma_invoice_links';
var FILES = 'accounting_proforma_signed_files';
var PF_COLS = 'id, proforma_number, proforma_date, status, record_status, total_amount, accounting_customer_id, business_id, wave_business_id, converted_invoice_id';
var INV_COLS = 'id, invoice_number, invoice_date, approval_status, record_status, total_amount, accounting_customer_id, business_id, wave_business_id';
var FILE_COLS = 'id, proforma_id, version, file_name, content_type, size_bytes, note, uploaded_by, uploaded_by_name, uploaded_at';
var READ_ACTIONS = { get: 1, map: 1, file_url: 1 };
var WRITE_ACTIONS = { link: 1, unlink: 1, upload_start: 1, upload_finish: 1 };
var OUTSIDE = 'That document is older than the history you are allowed to see.';

function admin() { return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } }); }
function fail(msg, st, extra) { return NextResponse.json(Object.assign({ ok: false, error: msg }, extra || {}), { status: st || 400 }); }
function tableMissing(err) {
  var m = String((err && err.message) || '');
  return (m.indexOf(LINKS) >= 0 || m.indexOf(FILES) >= 0) && /does not exist|Could not find|schema cache/i.test(m);
}
function bucketMissing(err) { return /bucket not found|not_found|does not exist/i.test(String((err && err.message) || '')) && !/object/i.test(String((err && err.message) || '')); }
function mayRead(ctx) { return userHasPermission(ctx, 'invoices.view') || userHasPermission(ctx, 'invoices.create') || userHasPermission(ctx, 'invoices.edit'); }
function mayWrite(ctx) { return userHasPermission(ctx, 'invoices.create') || userHasPermission(ctx, 'invoices.edit'); }
function fileOut(f, newestVersion) {
  return { id: f.id, proforma_id: f.proforma_id, version: f.version, file_name: f.file_name, content_type: f.content_type, size_bytes: Number(f.size_bytes) || 0,
    note: f.note || null, uploaded_by_name: f.uploaded_by_name || null, uploaded_at: f.uploaded_at || null, newest: Number(f.version) === Number(newestVersion) };
}
function pfOut(p) { return { id: p.id, proforma_number: p.proforma_number || null, proforma_date: p.proforma_date || null, status: p.status || null, record_status: p.record_status || 'active', total_amount: p.total_amount, accounting_customer_id: p.accounting_customer_id || null }; }
function invOut(i) { return { id: i.id, invoice_number: i.invoice_number || null, invoice_date: i.invoice_date || null, approval_status: i.approval_status || null, record_status: i.record_status || 'active', total_amount: i.total_amount, accounting_customer_id: i.accounting_customer_id || null }; }

async function one(db, table, cols, id) {
  var r = await db.from(table).select(cols).eq('id', id).maybeSingle();
  if (r.error) { throw new Error(r.error.message); }
  return r.data || null;
}
async function allRows(db, table, cols, build) {
  var out = []; var from = 0; var STEP = 1000; var guard = 0;
  while (guard < 200) {
    var q = db.from(table).select(cols);
    if (build) { q = build(q); }
    var r = await q.order('id', { ascending: true }).range(from, from + STEP - 1);
    if (r.error) { var e = new Error(r.error.message); e.missing = tableMissing(r.error); throw e; }
    var rows = r.data || [];
    out = out.concat(rows);
    if (rows.length < STEP) { break; }
    from += STEP; guard++;
  }
  return out;
}
async function byIds(db, table, cols, ids) {
  var out = {}; var uniq = []; var seen = {};
  (ids || []).forEach(function (x) { if (x && !seen[x]) { seen[x] = 1; uniq.push(x); } });
  for (var i = 0; i < uniq.length; i += 200) {
    var r = await db.from(table).select(cols).in('id', uniq.slice(i, i + 200));
    if (r.error) { throw new Error(r.error.message); }
    (r.data || []).forEach(function (row) { out[row.id] = row; });
  }
  return out;
}
// the two new tables, read so that a database that has not had the update yet answers "not installed" instead of failing
async function softRows(db, table, cols, build) {
  try { return { rows: await allRows(db, table, cols, build), installed: true }; }
  catch (e) { if (e && e.missing) { return { rows: [], installed: false }; } throw e; }
}
async function personName(db, userId) {
  try { var u = await db.from('users').select('id, name, email').eq('id', userId).maybeSingle(); return (u && u.data && (u.data.name || u.data.email)) || null; }
  catch (e) { return null; }
}
async function filesOf(db, proformaId) {
  var got = await softRows(db, FILES, FILE_COLS, function (q) { return q.eq('proforma_id', proformaId); });
  var rows = got.rows.slice().sort(function (a, b) { return Number(b.version) - Number(a.version); });
  var newest = rows.length ? rows[0].version : 0;
  return { installed: got.installed, files: rows.map(function (f) { return fileOut(f, newest); }) };
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
    if (!mayRead(ctx)) { return fail('You need the Invoices: View switch to see proforma links and signed proformas. Ask the super admin.', 403); }
    var canEdit = mayWrite(ctx);
    if (WRITE_ACTIONS[action] && !canEdit) { return fail('You need the Invoice: Create or Invoice: Edit switch for that. Ask the super admin.', 403); }
    var win = await windowFloorFor(db, ctx);
    if (win.error) { return fail(win.error, 503); }
    var floor = win.floor || null;

    // ── map: the small marks on the two lists (which invoice has a proforma, which proforma has invoices / a signed copy)
    if (action === 'map') {
      var mLinks = await softRows(db, LINKS, 'id, proforma_id, invoice_id', function (q) { return q.is('removed_at', null); });
      var mFiles = await softRows(db, FILES, 'id, proforma_id, version', null);
      var mConv = await allRows(db, 'accounting_proformas', 'id, converted_invoice_id', function (q) { return q.not('converted_invoice_id', 'is', null); });
      var pairs = []; var seenPair = {};
      mLinks.rows.forEach(function (l) { var k = l.proforma_id + '|' + l.invoice_id; if (!seenPair[k]) { seenPair[k] = 1; pairs.push({ p: l.proforma_id, i: l.invoice_id }); } });
      mConv.forEach(function (p) { if (!p.converted_invoice_id) { return; } var k = p.id + '|' + p.converted_invoice_id; if (!seenPair[k]) { seenPair[k] = 1; pairs.push({ p: p.id, i: p.converted_invoice_id }); } });
      var pfIds = pairs.map(function (x) { return x.p; }).concat(mFiles.rows.map(function (f) { return f.proforma_id; }));
      var pfMap = await byIds(db, 'accounting_proformas', 'id, proforma_number, proforma_date', pfIds);
      var invMap = await byIds(db, 'accounting_invoices', 'id, invoice_number, invoice_date', pairs.map(function (x) { return x.i; }));
      var byInvoice = {}; var byProforma = {};
      var slot = function (pid) { if (!byProforma[pid]) { byProforma[pid] = { invoices: 0, signed: 0 }; } return byProforma[pid]; };
      pairs.forEach(function (x) {
        var p = pfMap[x.p]; var i = invMap[x.i];
        if (!p || !i) { return; }
        if (!insideWindow(p.proforma_date, floor) || !insideWindow(i.invoice_date, floor)) { return; }
        if (!byInvoice[x.i]) { byInvoice[x.i] = { proforma_id: p.id, proforma_number: p.proforma_number || null }; }
        slot(x.p).invoices += 1;
      });
      mFiles.rows.forEach(function (f) { var p = pfMap[f.proforma_id]; if (!p || !insideWindow(p.proforma_date, floor)) { return; } slot(f.proforma_id).signed += 1; });
      return NextResponse.json({ ok: true, installed: mLinks.installed && mFiles.installed, can_edit: canEdit, by_invoice: byInvoice, by_proforma: byProforma });
    }

    // ── get: everything the box on one invoice or one proforma shows
    if (action === 'get') {
      var kind = body.kind === 'proforma' ? 'proforma' : 'invoice';
      var id = String(body.id || '');
      if (!isUuid(id)) { return fail('Which ' + kind + '?'); }
      if (kind === 'invoice') {
        var inv = await one(db, 'accounting_invoices', INV_COLS, id);
        if (!inv) { return fail('This invoice is not there any more — refresh the list.', 404); }
        if (!insideWindow(inv.invoice_date, floor)) { return fail(OUTSIDE, 403); }
        var gl = await softRows(db, LINKS, 'id, proforma_id, invoice_id, linked_by_name, linked_at, other_customer_confirmed', function (q) { return q.eq('invoice_id', id).is('removed_at', null); });
        var link = gl.rows[0] || null; var via = link ? 'link' : null; var pf = null;
        if (link) { pf = await one(db, 'accounting_proformas', PF_COLS, link.proforma_id); }
        if (!pf) {
          var cv = await db.from('accounting_proformas').select(PF_COLS).eq('converted_invoice_id', id).order('created_at', { ascending: true }).limit(1);
          if (cv.error) { throw new Error(cv.error.message); }
          if (cv.data && cv.data[0]) { pf = cv.data[0]; via = 'convert'; link = null; }
        }
        var outI = { ok: true, kind: 'invoice', installed: gl.installed, can_edit: canEdit, proforma: null, files: [] };
        if (pf) {
          if (!insideWindow(pf.proforma_date, floor)) { outI.proforma = { hidden: true, via: via }; }
          else {
            var fi = await filesOf(db, pf.id);
            outI.proforma = Object.assign(pfOut(pf), { via: via, link_id: link ? link.id : null, linked_by_name: link ? (link.linked_by_name || null) : null, linked_at: link ? link.linked_at : null, other_customer: !!(link && link.other_customer_confirmed) });
            outI.files = fi.files; outI.installed = outI.installed && fi.installed;
          }
        }
        return NextResponse.json(outI);
      }
      var pfr = await one(db, 'accounting_proformas', PF_COLS, id);
      if (!pfr) { return fail('This proforma is not there any more — refresh the list.', 404); }
      if (!insideWindow(pfr.proforma_date, floor)) { return fail(OUTSIDE, 403); }
      var pl = await softRows(db, LINKS, 'id, proforma_id, invoice_id, invoice_number, linked_by_name, linked_at, other_customer_confirmed, removed_at, removed_by_name, removed_reason', function (q) { return q.eq('proforma_id', id); });
      var wanted = pl.rows.map(function (l) { return l.invoice_id; });
      if (pfr.converted_invoice_id) { wanted.push(pfr.converted_invoice_id); }
      var invs = await byIds(db, 'accounting_invoices', INV_COLS, wanted);
      var listed = []; var earlier = []; var hiddenCount = 0; var have = {};
      pl.rows.forEach(function (l) {
        var iv = invs[l.invoice_id];
        if (l.removed_at) { earlier.push({ invoice_number: (iv && insideWindow(iv.invoice_date, floor) ? iv.invoice_number : null) || (floor ? null : l.invoice_number) || null, linked_by_name: l.linked_by_name || null, linked_at: l.linked_at, removed_by_name: l.removed_by_name || null, removed_at: l.removed_at, removed_reason: l.removed_reason || null }); return; }
        have[l.invoice_id] = 1;
        if (!iv) { listed.push({ id: null, gone: true, invoice_number: floor ? null : (l.invoice_number || null), via: 'link', link_id: l.id, linked_by_name: l.linked_by_name || null, linked_at: l.linked_at }); return; }
        if (!insideWindow(iv.invoice_date, floor)) { hiddenCount += 1; return; }
        listed.push(Object.assign(invOut(iv), { via: 'link', link_id: l.id, linked_by_name: l.linked_by_name || null, linked_at: l.linked_at, other_customer: l.other_customer_confirmed === true }));
      });
      if (pfr.converted_invoice_id && !have[pfr.converted_invoice_id]) {
        var civ = invs[pfr.converted_invoice_id];
        if (!civ) { listed.unshift({ id: null, gone: true, invoice_number: null, via: 'convert', link_id: null }); }
        else if (!insideWindow(civ.invoice_date, floor)) { hiddenCount += 1; }
        else { listed.unshift(Object.assign(invOut(civ), { via: 'convert', link_id: null })); }
      }
      var fp = await filesOf(db, id);
      return NextResponse.json({ ok: true, kind: 'proforma', installed: pl.installed && fp.installed, can_edit: canEdit, proforma: pfOut(pfr), invoices: listed, hidden_invoices: hiddenCount, earlier_links: earlier, files: fp.files });
    }

    // ── file_url: a short-lived link to ONE signed file, after the same checks
    if (action === 'file_url') {
      var fid = String(body.file_id || '');
      if (!isUuid(fid)) { return fail('Which file?'); }
      var fr = await db.from(FILES).select('id, proforma_id, storage_bucket, storage_path, file_name, version').eq('id', fid).maybeSingle();
      if (fr.error) { return tableMissing(fr.error) ? fail(PROFORMA_LINKS_SQL_MISSING, 409) : fail('The file could not be looked up (' + fr.error.message + ').', 500); }
      if (!fr.data) { return fail('That file is not on record.', 404); }
      var fpf = await one(db, 'accounting_proformas', PF_COLS, fr.data.proforma_id);
      if (!fpf) { return fail('The proforma of that file is not there any more.', 404); }
      if (!insideWindow(fpf.proforma_date, floor)) { return fail(OUTSIDE, 403); }
      var su = await db.storage.from(fr.data.storage_bucket || SIGNED_BUCKET).createSignedUrl(fr.data.storage_path, 300, body.download === true ? { download: fr.data.file_name } : undefined);
      if (su.error || !su.data || !su.data.signedUrl) { return fail('The file could not be opened (' + ((su.error && su.error.message) || 'no link') + ').', 502); }
      return NextResponse.json({ ok: true, url: su.data.signedUrl, file_name: fr.data.file_name, version: fr.data.version, expires_in_seconds: 300 });
    }

    // ── link: an existing invoice to an existing proforma
    if (action === 'link') {
      var lp = String(body.proforma_id || ''); var li = String(body.invoice_id || '');
      if (!isUuid(lp) || !isUuid(li)) { return fail('Pick the proforma and the invoice to link.'); }
      var lPf = await one(db, 'accounting_proformas', PF_COLS, lp);
      var lInv = await one(db, 'accounting_invoices', INV_COLS, li);
      if (!lPf) { return fail('That proforma is not there any more — refresh the list.', 404); }
      if (!lInv) { return fail('That invoice is not there any more — refresh the list.', 404); }
      if (!insideWindow(lPf.proforma_date, floor) || !insideWindow(lInv.invoice_date, floor)) { return fail(OUTSIDE, 403); }
      var prob = linkProblem(lPf, lInv, body.confirm_other_customer === true);
      if (!prob.ok) { return fail(prob.msg, 409, { code: prob.code }); }
      if (lPf.converted_invoice_id && String(lPf.converted_invoice_id) === li) { return fail('This invoice was made from this proforma by Convert — they are already linked.', 409, { code: 'already' }); }
      var oc = await db.from('accounting_proformas').select('id, proforma_number').eq('converted_invoice_id', li).limit(1);
      if (oc.error) { throw new Error(oc.error.message); }
      if (oc.data && oc.data[0]) { return fail('This invoice was made by Convert from proforma ' + (oc.data[0].proforma_number || '(no number)') + '. An invoice belongs to one proforma only.', 409, { code: 'taken' }); }
      var ex = await db.from(LINKS).select('id, proforma_id, proforma_number').eq('invoice_id', li).is('removed_at', null).limit(1);
      if (ex.error) { return tableMissing(ex.error) ? fail(PROFORMA_LINKS_SQL_MISSING, 409) : fail('Not saved (' + ex.error.message + '). Nothing was changed.', 500); }
      if (ex.data && ex.data[0]) {
        if (String(ex.data[0].proforma_id) === lp) { return fail('They are already linked.', 409, { code: 'already' }); }
        return fail('This invoice is already linked to proforma ' + (ex.data[0].proforma_number || '(no number)') + '. Unlink it there first — an invoice belongs to one proforma only.', 409, { code: 'taken' });
      }
      var differentCustomer = !!(lPf.accounting_customer_id && lInv.accounting_customer_id && String(lPf.accounting_customer_id) !== String(lInv.accounting_customer_id));
      var lName = await personName(db, userId);
      var insL = await db.from(LINKS).insert({ proforma_id: lp, invoice_id: li, proforma_number: lPf.proforma_number || null, invoice_number: lInv.invoice_number || null, other_customer_confirmed: differentCustomer, linked_by: userId, linked_by_name: lName }).select('id, linked_at').maybeSingle();
      if (insL.error) {
        if (tableMissing(insL.error)) { return fail(PROFORMA_LINKS_SQL_MISSING, 409); }
        if (/uq_pf_inv_links_active_invoice|duplicate key/i.test(String(insL.error.message || '')) || insL.error.code === '23505') { return fail('Someone linked this invoice a moment ago — refresh to see it. Nothing was changed.', 409, { code: 'taken' }); }
        return fail('Not saved (' + insL.error.message + '). Nothing was changed.', 500);
      }
      if (!insL.data) { return fail('Not saved — the link did not come back from the database. Refresh and check.', 500); }
      await audit(db, userId, 'proforma_invoice_linked', 'accounting_proformas', lp, { link_id: insL.data.id, invoice_id: li, invoice_number: lInv.invoice_number || null, proforma_number: lPf.proforma_number || null, different_customer_confirmed: differentCustomer });
      return NextResponse.json({ ok: true, link_id: insL.data.id });
    }

    // ── unlink: the link row is stamped and kept; nothing is removed
    if (action === 'unlink') {
      var lid = String(body.link_id || '');
      if (!isUuid(lid)) { return fail('Which link?'); }
      var cur = await db.from(LINKS).select('id, proforma_id, invoice_id, proforma_number, invoice_number, removed_at').eq('id', lid).maybeSingle();
      if (cur.error) { return tableMissing(cur.error) ? fail(PROFORMA_LINKS_SQL_MISSING, 409) : fail('Not saved (' + cur.error.message + '). Nothing was changed.', 500); }
      if (!cur.data) { return fail('That link is not on record — refresh.', 404); }
      if (cur.data.removed_at) { return fail('That link was already removed — refresh.', 409); }
      var uPf = await one(db, 'accounting_proformas', PF_COLS, cur.data.proforma_id);
      var uInv = await one(db, 'accounting_invoices', INV_COLS, cur.data.invoice_id);
      if ((uPf && !insideWindow(uPf.proforma_date, floor)) || (uInv && !insideWindow(uInv.invoice_date, floor))) { return fail(OUTSIDE, 403); }
      var reason = String(body.reason || '').trim().substring(0, 300) || null;
      var uName = await personName(db, userId);
      var upd = await db.from(LINKS).update({ removed_at: new Date().toISOString(), removed_by: userId, removed_by_name: uName, removed_reason: reason }).eq('id', lid).is('removed_at', null).select('id');
      if (upd.error) { return fail('Not saved (' + upd.error.message + '). Nothing was changed.', 500); }
      if (!upd.data || upd.data.length !== 1) { return fail('That link was already removed by someone else — refresh.', 409); }
      await audit(db, userId, 'proforma_invoice_unlinked', 'accounting_proformas', cur.data.proforma_id, { link_id: lid, invoice_id: cur.data.invoice_id, invoice_number: cur.data.invoice_number || null, proforma_number: cur.data.proforma_number || null, reason: reason });
      return NextResponse.json({ ok: true });
    }

    // ── upload_start: one ticket for one new path under this proforma (the browser then sends the file straight to the store)
    if (action === 'upload_start') {
      var sp = String(body.proforma_id || '');
      if (!isUuid(sp)) { return fail('Which proforma?'); }
      var sPf = await one(db, 'accounting_proformas', PF_COLS, sp);
      if (!sPf) { return fail('That proforma is not there any more — refresh the list.', 404); }
      if (!insideWindow(sPf.proforma_date, floor)) { return fail(OUTSIDE, 403); }
      var sSize = Number(body.size) || 0; var sType = String(body.content_type || '').toLowerCase();
      if (sSize > SIGNED_MAX_BYTES) { return fail('That file is ' + sizeWords(sSize) + ' — the limit is 15 MB.', 413); }
      if (sType && SIGNED_TYPES.indexOf(sType) < 0) { return fail('A signed proforma must be a PDF or a picture (JPG, PNG or WEBP).', 415); }
      var probe = await db.from(FILES).select('id').eq('proforma_id', sp).limit(1);
      if (probe.error) { return tableMissing(probe.error) ? fail(PROFORMA_LINKS_SQL_MISSING, 409) : fail('Not started (' + probe.error.message + ').', 500); }
      var sPath = signedPathFor(sp, Date.now(), crypto.randomBytes(8).toString('hex'), body.file_name);
      var tk = await db.storage.from(SIGNED_BUCKET).createSignedUploadUrl(sPath);
      if (tk.error || !tk.data || !tk.data.token) {
        if (bucketMissing(tk.error)) { return fail(PROFORMA_LINKS_SQL_MISSING, 409); }
        return fail('The upload could not be started (' + ((tk.error && tk.error.message) || 'no ticket') + ').', 502);
      }
      return NextResponse.json({ ok: true, bucket: SIGNED_BUCKET, path: sPath, token: tk.data.token });
    }

    // ── upload_finish: the SERVER fetches what arrived, checks the real bytes, and adds the next version. Nothing is replaced.
    if (action === 'upload_finish') {
      var fpId = String(body.proforma_id || ''); var fPath = String(body.path || '');
      if (!isUuid(fpId)) { return fail('Which proforma?'); }
      if (!isSignedPathOf(fPath, fpId)) { return fail('That upload does not belong to this proforma.', 400); }
      var fPf = await one(db, 'accounting_proformas', PF_COLS, fpId);
      if (!fPf) { return fail('That proforma is not there any more — refresh the list.', 404); }
      if (!insideWindow(fPf.proforma_date, floor)) { return fail(OUTSIDE, 403); }
      var have2 = await db.from(FILES).select('id, version, storage_path, sha256').eq('proforma_id', fpId);
      if (have2.error) { return tableMissing(have2.error) ? fail(PROFORMA_LINKS_SQL_MISSING, 409) : fail('Not saved (' + have2.error.message + ').', 500); }
      var existing = have2.data || [];
      if (existing.some(function (x) { return x.storage_path === fPath; })) { return fail('That upload is already saved.', 409, { code: 'already' }); }
      var dl = await db.storage.from(SIGNED_BUCKET).download(fPath);
      if (dl.error || !dl.data) { return fail('The file did not arrive in the store — nothing was saved. Try the upload again.', 409, { code: 'not_arrived' }); }
      var buf = Buffer.from(await dl.data.arrayBuffer());
      if (!buf.length) { return fail('The file arrived empty — nothing was saved.', 400); }
      if (buf.length > SIGNED_MAX_BYTES) { return fail('That file is ' + sizeWords(buf.length) + ' — the limit is 15 MB. Nothing was saved.', 413); }
      var realType = sniffSignedFile(buf);
      if (!realType) { return fail('That file is not a real PDF, JPG, PNG or WEBP — nothing was saved.', 415); }
      var sha = crypto.createHash('sha256').update(buf).digest('hex');
      var same = existing.filter(function (x) { return x.sha256 === sha; })[0];
      if (same) { return fail('This exact file is already saved as version ' + same.version + '. Nothing was added.', 409, { code: 'same_file', version: same.version }); }
      var upName = await personName(db, userId);
      var shownName = safeFileName(body.file_name || fPath.substring(fPath.lastIndexOf('/') + 1).replace(/^[0-9]+-[0-9a-f]{16}-/, ''));
      var note = String(body.note || '').trim().substring(0, 300) || null;
      var saved = null; var lastErr = null;
      for (var attempt = 0; attempt < 4 && !saved; attempt++) {
        if (attempt > 0) {
          var again = await db.from(FILES).select('id, version, sha256').eq('proforma_id', fpId);
          if (again.error) { return fail('Not saved (' + again.error.message + ').', 500); }
          existing = again.data || [];
          var same2 = existing.filter(function (x) { return x.sha256 === sha; })[0];
          if (same2) { return fail('This exact file is already saved as version ' + same2.version + '. Nothing was added.', 409, { code: 'same_file', version: same2.version }); }
        }
        var ver = nextVersion(existing);
        var insF = await db.from(FILES).insert({ proforma_id: fpId, version: ver, storage_bucket: SIGNED_BUCKET, storage_path: fPath, file_name: shownName, content_type: realType, size_bytes: buf.length, sha256: sha, note: note, uploaded_by: userId, uploaded_by_name: upName }).select(FILE_COLS).maybeSingle();
        if (!insF.error && insF.data) { saved = insF.data; break; }
        lastErr = insF.error || { message: 'the row did not come back' };
        if (!(insF.error && (insF.error.code === '23505' || /duplicate key|uq_pf_signed/i.test(String(insF.error.message || ''))))) { break; }
        if (/uq_pf_signed_path/.test(String(insF.error.message || ''))) { return fail('That upload is already saved.', 409, { code: 'already' }); }
      }
      if (!saved) { return fail('Not saved (' + ((lastErr && lastErr.message) || 'error') + '). The earlier versions are untouched.', 500); }
      await audit(db, userId, 'proforma_signed_uploaded', 'accounting_proformas', fpId, { file_id: saved.id, version: saved.version, file_name: saved.file_name, content_type: realType, size_bytes: buf.length, sha256: sha, proforma_number: fPf.proforma_number || null });
      return NextResponse.json({ ok: true, file: fileOut(saved, saved.version), kept_versions: existing.length });
    }
    return fail('Unknown action.');
  } catch (e) {
    return fail('Something went wrong on the server (' + ((e && e.message) || 'error') + '). Refresh and check before trying again.', 500);
  }
}
