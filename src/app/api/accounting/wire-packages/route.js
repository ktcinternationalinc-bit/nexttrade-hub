// v55.83-RH — Prepared wires: APPROVED BEFORE THE MONEY LEAVES (Max, Nov 8):
//  16:04 "the wire should be set up before a wire is actually sent ...then
//        later when the wire is sent than we attach that whole audit to that
//        wire with the attached bills etc"
//  16:12 "wirepreparation is a permissioning. not all of wire will be to one
//        vendor-- BECASUE most of the wires would be going out of RTM..but
//        preparation should be before we send the payment to RTM"
//  16:14 "rtm fee is optional ... i like the rtm proof...attach a wire proof
//        that attaches to wires as part of the approgal. nextrade --not
//        necessary but can be only with bills"
//
// Flow: PREPARE (Wires: Prepare) → 🤖 audit + AI → ✍ 1st + ✍ 2nd sign-off by
// two different people (Wires: Sign Off) → SEND with the bank's wire
// confirmation attached (Wires: Send) → ATTACH to the bank line when it posts
// (bills are recorded paid THEN) → RTM's proof per bill (RTM / NextTrade).
// Every step: append-only audit trail. The locks are also in the database.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { assertPermission } from '../../../../lib/server-permissions';
import { audit } from '../../../../lib/audit-server';
import { autoReviewIfComplete } from '../../../../lib/bank-allocation-server';
import { US_WAVE_BUSINESS_ID } from '../../../../lib/business-of';
import { auditPackage, packageFingerprint, packageStatus, packageTotals, packageLabel, normRef, samePayee } from '../../../../lib/wire-audit';
import { packageContext, inChunks, loadPayParties, aiReviewPackage } from '../../../../lib/wire-package-server';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function admin() { return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } }); }
function r2(x) { return Math.round((Number(x) || 0) * 100) / 100; }
function isDate(s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')); }
function isUuid(s) { return /^[0-9a-f-]{36}$/i.test(String(s || '')); }
function nowIso() { return new Date().toISOString(); }
var SQL_HINT = ' — run sql/v55-83-RH-wire-packages.sql in Supabase first.';
function fail(msg, status) { return NextResponse.json({ ok: false, error: msg }, { status: status || 400 }); }
function dbErr(e) { var m = (e && e.message) || 'database error'; return fail(m + (/wire_package/.test(m) && !/WIRE_PACKAGE_LOCKED/.test(m) ? SQL_HINT : ''), /WIRE_PACKAGE_LOCKED/.test(m) ? 409 : 400); }

async function pageAll(mk) {
  var acc = [];
  for (var pg = 0; pg < 40; pg++) {
    var r = await mk().order('id', { ascending: true }).range(pg * 1000, pg * 1000 + 999);
    if (r.error) { return { data: acc, error: r.error }; }
    acc = acc.concat(r.data || []);
    if (!r.data || r.data.length < 1000) { break; }
  }
  return { data: acc, error: null };
}
async function userNames(db, ids) {
  var out = {}; var want = ids.filter(function (x, i, a) { return x && a.indexOf(x) === i; });
  if (!want.length) { return out; }
  var u = await db.from('users').select('id, name').in('id', want);
  ((u && u.data) || []).forEach(function (r) { out[r.id] = r.name || 'user'; });
  return out;
}
async function perm(db, userId, keys, req) {
  for (var i = 0; i < keys.length; i++) { var g = await assertPermission(db, userId, keys[i], req); if (g && g.ok) { return g; } }
  return null;
}
// load one package with its lines, the audit input, the live fingerprint and status
async function loadPackage(db, id) {
  var pr = await db.from('wire_packages').select('*').eq('id', id).maybeSingle();
  if (pr.error) { return { error: pr.error }; }
  if (!pr.data) { return { missing: true }; }
  var lr = await db.from('wire_package_lines').select('*').eq('package_id', id).order('created_at', { ascending: true });
  if (lr.error) { return { error: lr.error }; }
  var ctx = await packageContext(db, id, lr.data || []);
  var pkg = pr.data;
  var input = { pkg: pkg, lines: ctx.lines, sameRelease: ctx.sameRelease, sameNumber: ctx.sameNumber, knownReleases: ctx.knownReleases, otherOpen: ctx.otherOpen };
  // once attached, the bills ARE paid by this wire — judge the frozen audit, not "paid before" by itself
  var live = auditPackage(input);
  var hash = packageFingerprint(pkg, ctx.lines);
  // v55.83-RJ (review gap 6) — proof that the vendors were paid is asked from RTM-type companies only (NextTrade: bills only, no proof step)
  var paidThrough = pkg.payee_kind === 'service_provider';
  var rtmPending = paidThrough ? ctx.lines.filter(function (l) { return !l.rtm.confirmed_at; }).length : 0;
  return { pkg: pkg, rawLines: lr.data || [], ctx: ctx, input: input, live: live, hash: hash, status: packageStatus(pkg, hash, rtmPending), rtmPending: rtmPending, paidThrough: paidThrough };
}

export async function POST(req) {
  try {
    var body = await req.json();
    var action = body.action;
    var db = admin();
    var userId = body.user_id || null;
    var g1 = await assertPermission(db, userId, 'accounting.clickbooks.access', req);
    if (!g1.ok) { return fail('This needs "P1a · ClickBooks (KTC Hub) Access" — Settings → 🏦 Banking & Accounting Access.', g1.status || 403); }
    var gView = await perm(db, userId, ['wires.view', 'wires.prepare', 'wires.signoff', 'wires.send'], req);
    if (!gView) { return fail('This needs "Wires: View" — Settings → 🏦 Banking & Accounting Access.', 403); }

    // ── who a wire can go to + the bills each one can carry
    if (action === 'payees') {
      var parties = await loadPayParties(db);
      var vb = await pageAll(function () { return db.from('vendor_bills').select('id, vendor_name, paid_via, record_status').eq('record_status', 'active'); });
      var vendors = [];
      (vb.data || []).forEach(function (b) { if (!b.paid_via && b.vendor_name && vendors.indexOf(b.vendor_name) < 0) { vendors.push(b.vendor_name); } });
      vendors.sort(function (a, b) { return String(a).localeCompare(String(b)); });
      return NextResponse.json({ ok: true, parties: parties, vendors: vendors });
    }
    if (action === 'open_bills') {
      var kindO = String(body.payee_kind || ''); var payeeO = normRef(body.payee_name);
      if (!payeeO && kindO !== 'vendor') { return fail('Pick who the wire goes to.'); }
      var bAll = await pageAll(function () { return db.from('vendor_bills').select('*').eq('record_status', 'active'); });
      if (bAll.error) { return dbErr(bAll.error); }
      // v55.83-RI (Max, Nov 9 10:37: "how to even choose a freaking bill. make it simple") —
      // RTM / NextTrade: their bills FIRST, then every other open bill nobody else pays (picking one
      // marks it "paid through" that company on save). Vendor: every open direct bill (the first
      // bill picked decides the vendor) — no hidden setup before a bill can be chosen.
      var mine = (bAll.data || []).filter(function (b) {
        if (kindO === 'vendor') { return !b.paid_via && (!payeeO || normRef(b.vendor_name) === payeeO); }
        return samePayee(b.paid_via, payeeO) || !b.paid_via;
      });
      var ids = mine.map(function (b) { return b.id; });
      var pays = ids.length ? await inChunks(db, 'vendor_bill_payments', 'bill_id, amount, voided', 'bill_id', ids) : [];
      var paidBy = {}; pays.forEach(function (p) { if (p.voided !== true) { paidBy[p.bill_id] = r2((paidBy[p.bill_id] || 0) + (Number(p.amount) || 0)); } });
      var openLines = ids.length ? await inChunks(db, 'wire_package_lines', 'package_id, bill_id, amount, is_open', 'bill_id', ids) : [];
      var onPkg = {}; var pkIds = [];
      openLines.forEach(function (l) { if (l.is_open && l.package_id !== body.package_id) { onPkg[l.bill_id] = l.package_id; if (pkIds.indexOf(l.package_id) < 0) { pkIds.push(l.package_id); } } });
      var pks = pkIds.length ? await inChunks(db, 'wire_packages', 'id, seq, status', 'id', pkIds) : [];
      var pkLab = {}; pks.forEach(function (p) { pkLab[p.id] = packageLabel(p); });
      var rowsO = mine.map(function (b) {
        var open = r2((Number(b.total_amount) || 0) - (paidBy[b.id] || 0));
        return { id: b.id, vendor_name: b.vendor_name, bill_number: b.bill_number, release_number: b.release_number || null, bill_date: b.bill_date, due_date: b.due_date,
          category: b.category, total_amount: r2(b.total_amount), paid: paidBy[b.id] || 0, open: open, disputed: b.disputed === true,
          validation_status: b.validation_status || null, on_package: onPkg[b.id] ? (pkLab[onPkg[b.id]] || 'another wire') : null,
          paid_via: b.paid_via || null, needs_mark: kindO !== 'vendor' && !b.paid_via, release_optional: kindO === 'affiliate' };
      }).filter(function (b) { return b.open > 0.005; }).sort(function (a, b) { return (a.needs_mark - b.needs_mark) || String(a.due_date || a.bill_date || '').localeCompare(String(b.due_date || b.bill_date || '')); });
      return NextResponse.json({ ok: true, bills: rowsO });
    }

    // ── list every package
    if (action === 'list') {
      var pl = await db.from('wire_packages').select('*').order('created_at', { ascending: false }).limit(300);
      if (pl.error) { return dbErr(pl.error); }
      var pkgs = pl.data || [];
      var pIds = pkgs.map(function (p) { return p.id; });
      var allL = pIds.length ? await inChunks(db, 'wire_package_lines', '*', 'package_id', pIds) : [];
      var bIds = []; allL.forEach(function (l) { if (bIds.indexOf(l.bill_id) < 0) { bIds.push(l.bill_id); } });
      var bl = bIds.length ? await inChunks(db, 'vendor_bills', 'id, vendor_name, bill_number, release_number, total_amount, record_status', 'id', bIds) : [];
      var bBy = {}; bl.forEach(function (b) { bBy[b.id] = b; });
      var nm = await userNames(db, [].concat(pkgs.map(function (p) { return p.created_by; }), pkgs.map(function (p) { return p.signoff1_by; }), pkgs.map(function (p) { return p.signoff2_by; }), pkgs.map(function (p) { return p.sent_by; })));
      var out = pkgs.map(function (p) {
        var ls = allL.filter(function (l) { return l.package_id === p.id; }).map(function (l) { return { line_id: l.id, bill_id: l.bill_id, amount: r2(l.amount), payment_id: l.payment_id, bill: bBy[l.bill_id] || {}, rtm: { confirmed_at: l.rtm_confirmed_at } }; });
        // the list uses the fingerprint of what is stored (bills' own edits show up when the package is opened)
        var h = packageFingerprint(p, ls);
        var pt = p.payee_kind === 'service_provider';
        var pend = pt ? ls.filter(function (l) { return !l.rtm.confirmed_at; }).length : 0;
        var vend = []; ls.forEach(function (l) { var v = l.bill.vendor_name || '?'; if (vend.indexOf(v) < 0) { vend.push(v); } });
        var t = packageTotals(p, ls);
        return { id: p.id, label: packageLabel(p), payee_name: p.payee_name, payee_kind: p.payee_kind, created_at: p.created_at, created_by: nm[p.created_by] || null,
          bills: ls.length, vendors: vend, bills_total: t.bills, fee: t.fee, total: p.approved_total != null ? r2(p.approved_total) : t.total,
          status: packageStatus(p, h, pend), rtm_pending: pend, sent_date: p.sent_date, bank_reference: p.bank_reference,
          signers: [nm[p.signoff1_by], nm[p.signoff2_by]].filter(Boolean), bank_transaction_id: p.bank_transaction_id };
      });
      return NextResponse.json({ ok: true, packages: out });
    }

    // ── save a DRAFT (create or replace its bills) — Wires: Prepare
    if (action === 'save_draft') {
      var gP = await perm(db, userId, ['wires.prepare'], req);
      if (!gP) { return fail('Preparing a wire needs "Wires: Prepare" — Settings → 🏦 Banking & Accounting Access.', 403); }
      // v55.83-RJ (review gap 7) — the RI column must exist BEFORE anything is written
      var colChk = await db.from('wire_package_lines').select('marked_paid_via').limit(1);
      if (colChk.error) { return fail('Run sql/v55-83-RI-wire-simple.sql in Supabase first (' + colChk.error.message + ').', 400); }
      var parties2 = await loadPayParties(db);
      var kindS = String(body.payee_kind || ''); var payeeS = String(body.payee_name || '').trim();
      if (kindS !== 'vendor') {
        var hit = null; parties2.forEach(function (p) { if (normRef(p.name) === normRef(payeeS)) { hit = p; } });
        if (!hit) { return fail('Unknown paid-through company "' + payeeS + '".'); }
        payeeS = hit.name; kindS = hit.kind === 'affiliate' ? 'affiliate' : 'service_provider';
      }
      var feeS = r2(String(body.fee_amount == null ? '' : body.fee_amount).replace(/,/g, ''));
      if (feeS < 0) { return fail('The fee cannot be negative.'); }
      if (feeS > 0 && kindS !== 'service_provider') { return fail(kindS === 'affiliate' ? 'NextTrade wires are bills only — no fee.' : 'A wire straight to a vendor is bills only — no fee.'); }
      var linesIn = Array.isArray(body.lines) ? body.lines : [];
      var seenB = {}; var clean = [];
      for (var li = 0; li < linesIn.length; li++) {
        var bid = String((linesIn[li] && linesIn[li].bill_id) || '');
        var amTyped = String((linesIn[li] && linesIn[li].amount) == null ? '' : linesIn[li].amount).trim();
        // commas only as thousands separators ("1,250.00"); anything else ("1,00.00") is refused, never guessed
        var amOk = /^\d+(\.\d+)?$/.test(amTyped) || /^\d{1,3}(,\d{3})+(\.\d+)?$/.test(amTyped);
        var am = r2(amTyped.replace(/,/g, ''));
        if (!isUuid(bid)) { return fail('A ticked bill was not recognised — reload and tick it again.'); }
        if (!amOk || !(am > 0)) { return fail('The amount "' + amTyped + '" is not a valid number — type it like 1250.00 or 1,250.00.'); }
        if (seenB[bid]) { return fail('The same bill is listed twice.'); }
        seenB[bid] = true; clean.push({ bill_id: bid, amount: am });
      }
      if (!clean.length) { return fail('Tick at least one bill — a wire is prepared from the bills it pays.'); }
      var bS = await inChunks(db, 'vendor_bills', 'id, vendor_name, bill_number, total_amount, record_status, paid_via', 'id', clean.map(function (c) { return c.bill_id; }));
      var pS = await inChunks(db, 'vendor_bill_payments', 'bill_id, amount, voided', 'bill_id', clean.map(function (c) { return c.bill_id; }));
      var bSBy = {}; bS.forEach(function (b) { bSBy[b.id] = b; });
      // a vendor wire: the bills decide the vendor (all must be ONE vendor)
      if (kindS === 'vendor') {
        var vset = {}; bS.forEach(function (b) { vset[normRef(b.vendor_name)] = b.vendor_name; });
        var vks = Object.keys(vset);
        if (vks.length > 1) { return fail('A wire straight to a vendor pays ONE vendor — these bills belong to ' + vks.map(function (k) { return vset[k]; }).join(', ') + '. Make one wire per vendor (or send them through RTM).'); }
        if (vks.length === 1) { payeeS = vset[vks[0]]; }
      }
      if (!payeeS) { return fail('Pick who the wire goes to.'); }
      // v55.83-RJ (review gap 8) — a bill without a "paid through" that is ticked for an RTM / NextTrade wire is only
      // MARKED when the wire is SENT; until then it stays in what-we-owe like any unpaid bill
      var willMark = {};
      for (var ci = 0; ci < clean.length; ci++) {
        var bb = bSBy[clean[ci].bill_id];
        if (!bb) { return fail('A bill on this wire was not found.', 404); }
        var whoB = (bb.vendor_name || 'A bill') + ' ' + (bb.bill_number || '');
        if (bb.record_status !== 'active') { return fail(whoB + ' is void — untick it.', 409); }
        if (kindS !== 'vendor') {
          if (!bb.paid_via) { willMark[bb.id] = true; }
          else if (!samePayee(bb.paid_via, payeeS)) { return fail(whoB + ' is paid through ' + bb.paid_via + ' — it goes on THAT company\'s wire. Untick it.', 409); }
        } else if (bb.paid_via) { return fail(whoB + ' is paid through ' + bb.paid_via + ' — it goes on ' + bb.paid_via + '\'s wire, not straight to the vendor. Untick it.', 409); }
        var paidS = 0; pS.forEach(function (p) { if (p.bill_id === bb.id && p.voided !== true) { paidS += Number(p.amount) || 0; } });
        var openS = r2((Number(bb.total_amount) || 0) - paidS);
        if (clean[ci].amount > openS + 0.005) { return fail(whoB + ': $' + clean[ci].amount.toFixed(2) + ' is more than what is still owed ($' + openS.toFixed(2) + ').' + (openS <= 0.005 ? ' It is already paid — untick it.' : ''), 409); }
      }
      var pkgId = body.id || null;
      // one bill, one open wire — checked BEFORE anything is written (the database enforces it too)
      var onOther = await inChunks(db, 'wire_package_lines', 'package_id, bill_id, is_open', 'bill_id', clean.map(function (c) { return c.bill_id; }));
      var clash = onOther.filter(function (l) { return l.is_open && l.package_id !== pkgId; });
      if (clash.length) {
        var cb = bSBy[clash[0].bill_id] || {};
        var cp = await db.from('wire_packages').select('seq').eq('id', clash[0].package_id).maybeSingle();
        return fail((cb.vendor_name || 'A bill') + ' ' + (cb.bill_number || '') + ' is already on wire ' + packageLabel((cp && cp.data) || {}) + ' — one bill, one wire. Untick it here, or cancel that wire.', 409);
      }
      var headS = { payee_kind: kindS, payee_name: payeeS, fee_amount: feeS, fee_note: String(body.fee_note || '').trim().substring(0, 300) || null, memo: String(body.memo || '').trim().substring(0, 500) || null };
      if (pkgId) {
        // v55.83-RJ (review gap 7) — change a draft WITHOUT ever leaving it empty: add new bills first, then update kept
        // ones, then remove unticked ones; a failure part-way leaves the old wire intact (signatures void via fingerprint)
        var ex = await db.from('wire_packages').select('id, status').eq('id', pkgId).maybeSingle();
        if (ex.error) { return dbErr(ex.error); }
        if (!ex.data) { return fail('Wire not found.', 404); }
        if (ex.data.status !== 'draft') { return fail('This wire is ' + ex.data.status + ' — it can no longer be changed.', 409); }
        var oldL = await db.from('wire_package_lines').select('id, bill_id, amount, marked_paid_via').eq('package_id', pkgId);
        if (oldL.error) { return dbErr(oldL.error); }
        var oldBy = {}; (oldL.data || []).forEach(function (l) { oldBy[l.bill_id] = l; });
        var adds = clean.filter(function (c) { return !oldBy[c.bill_id]; });
        if (adds.length) {
          var insA = await db.from('wire_package_lines').insert(adds.map(function (c) { return { package_id: pkgId, bill_id: c.bill_id, amount: c.amount, marked_paid_via: willMark[c.bill_id] === true }; }));
          if (insA.error) { return fail(/uq_wpkg_line_open_bill/.test(insA.error.message || '') ? 'One of these bills was just put on another wire — untick it.' : insA.error.message, 409); }
        }
        for (var ki = 0; ki < clean.length; ki++) {
          var o0 = oldBy[clean[ki].bill_id];
          if (o0 && (r2(o0.amount) !== clean[ki].amount || (o0.marked_paid_via === true) !== (willMark[clean[ki].bill_id] === true))) {
            var uk = await db.from('wire_package_lines').update({ amount: clean[ki].amount, marked_paid_via: willMark[clean[ki].bill_id] === true }).eq('id', o0.id);
            if (uk.error) { return dbErr(uk.error); }
          }
        }
        var gone = (oldL.data || []).filter(function (l) { return !seenB[l.bill_id]; }).map(function (l) { return l.id; });
        if (gone.length) { var dg = await db.from('wire_package_lines').delete().in('id', gone); if (dg.error) { return dbErr(dg.error); } }
        var upP = await db.from('wire_packages').update(Object.assign({ updated_at: nowIso() }, headS)).eq('id', pkgId).eq('status', 'draft');
        if (upP.error) { return dbErr(upP.error); }
      } else {
        var insP = await db.from('wire_packages').insert(Object.assign({ created_by: userId }, headS)).select('id, seq').single();
        if (insP.error) { return dbErr(insP.error); }
        pkgId = insP.data.id;
        var insL = await db.from('wire_package_lines').insert(clean.map(function (c) { return { package_id: pkgId, bill_id: c.bill_id, amount: c.amount, marked_paid_via: willMark[c.bill_id] === true }; }));
        if (insL.error) {
          // never leave an empty draft behind (review gap 7)
          await db.from('wire_packages').delete().eq('id', pkgId).eq('status', 'draft');
          return fail(/uq_wpkg_line_open_bill/.test(insL.error.message || '') ? 'One of these bills was just put on another wire — untick it and save again.' : insL.error.message, 409);
        }
      }
      var totS = packageTotals({ fee_amount: feeS }, clean);
      // the 🤖 check runs by itself on every save (the AI part is limited to 20 seconds)
      var autoA = null;
      try {
        var PA = await loadPackage(db, pkgId);
        if (PA && PA.pkg && PA.pkg.status === 'draft') {
          var aiA = await aiReviewPackage(PA.pkg, PA.ctx.lines, PA.live, PA.ctx);
          await db.from('wire_packages').update({ check_hash: PA.hash, checked_at: nowIso(), checked_by: userId, check_result: PA.live, check_pass: PA.live.pass,
            ai_summary: aiA.text, ai_ok: aiA.ok, updated_at: nowIso() }).eq('id', pkgId).eq('status', 'draft');
          await audit(db, userId, 'wire_package_audit_run', 'wire_package', pkgId, { pass: PA.live.pass, blocks: PA.live.blocks, warns: PA.live.warns, ai_ok: aiA.ok, fingerprint: PA.hash, total: PA.live.total, auto: true });
          autoA = { pass: PA.live.pass, blocks: PA.live.blocks, warns: PA.live.warns, ai_ok: aiA.ok };
        }
      } catch (eAA) { autoA = null; }
      await audit(db, userId, body.id ? 'wire_package_updated' : 'wire_package_prepared', 'wire_package', pkgId, { payee: payeeS, kind: kindS, bills: clean.length, bills_total: totS.bills, fee: feeS, total: totS.total, will_mark_paid_via: Object.keys(willMark) });
      return NextResponse.json({ ok: true, id: pkgId, total: totS.total, audit: autoA, will_mark: Object.keys(willMark).length });
    }

    // ── v55.83-RI (Max, Nov 9 10:34: "where the hell are all of the permisssioning and the setup?")
    // One readiness check: tables installed, who can do each step, bills ready to go on a wire, AI key.
    if (action === 'setup') {
      var outS = { ok: true, sql_ok: true, sql_error: null, parties: [], bills: { by_party: {}, direct: 0, missing_release: 0, missing_release_paid_via: 0, total_open: 0 }, people: {}, ai_key_set: !!process.env.ANTHROPIC_API_KEY };
      try { var tq0 = await db.from('wire_packages').select('id').limit(1); if (tq0.error) { outS.sql_ok = false; outS.sql_error = tq0.error.message; } } catch (eT0) { outS.sql_ok = false; outS.sql_error = eT0.message; }
      try { var tq1 = await db.from('wire_audits').select('id').limit(1); if (tq1.error) { outS.sql_ok = false; outS.sql_error = tq1.error.message; } } catch (eT1) { outS.sql_ok = false; }
      try { var tq2 = await db.from('wire_package_lines').select('marked_paid_via').limit(1); if (tq2.error) { outS.sql_ok = false; outS.sql_error = 'Run sql/v55-83-RI-wire-simple.sql (' + tq2.error.message + ')'; } } catch (eT2) { outS.sql_ok = false; }
      outS.parties = await loadPayParties(db);
      outS.unknown_paid_via = {};
      var bOpen = await pageAll(function () { return db.from('vendor_bills').select('id, total_amount, paid_via, release_number, record_status').eq('record_status', 'active'); });
      var openIds = (bOpen.data || []).map(function (b) { return b.id; });
      var pz = openIds.length ? await inChunks(db, 'vendor_bill_payments', 'bill_id, amount, voided', 'bill_id', openIds) : [];
      var pd = {}; pz.forEach(function (x) { if (x.voided !== true) { pd[x.bill_id] = (pd[x.bill_id] || 0) + (Number(x.amount) || 0); } });
      (bOpen.data || []).forEach(function (b) {
        if ((Number(b.total_amount) || 0) - (pd[b.id] || 0) <= 0.005) { return; }
        outS.bills.total_open += 1;
        if (b.paid_via) {
          outS.bills.by_party[b.paid_via] = (outS.bills.by_party[b.paid_via] || 0) + 1;
          if (!outS.parties.some(function (pp) { return samePayee(b.paid_via, pp.name); })) { outS.unknown_paid_via[b.paid_via] = (outS.unknown_paid_via[b.paid_via] || 0) + 1; }
        } else { outS.bills.direct += 1; }
        if (!String(b.release_number || '').trim()) { outS.bills.missing_release += 1; if (b.paid_via) { outS.bills.missing_release_paid_via += 1; } }
      });
      // who can do each step: owners / admins / super admins always; others need ClickBooks access (P1a) + the switch
      var KEYS = ['wires.view', 'wires.prepare', 'wires.signoff', 'wires.send', 'recon.signoff'];
      var ur = await db.from('users').select('id, name, role, active');
      var usersS = ((ur && ur.data) || []).filter(function (u) { return u.active !== false; });
      var mpR = await db.from('module_permissions').select('user_id, module_name, has_access').in('module_name', KEYS.concat(['accounting.clickbooks.access', 'accounting.view'])).eq('has_access', true);
      var g = {}; ((mpR && mpR.data) || []).forEach(function (r) { (g[r.user_id] = g[r.user_id] || {})[r.module_name] = true; });
      KEYS.forEach(function (k) { outS.people[k] = []; });
      outS.role = (g1 && g1.ctx && g1.ctx.role) || null;
      usersS.forEach(function (u) {
        var boss = u.role === 'super_admin' || u.role === 'owner' || u.role === 'admin';
        var m = g[u.id] || {}; var p1 = boss || m['accounting.clickbooks.access'] === true || m['accounting.view'] === true;
        KEYS.forEach(function (k) {
          var has = boss || (p1 && m[k] === true);
          var viewOnly = k === 'wires.view' && !boss && p1 && (m['wires.prepare'] || m['wires.signoff'] || m['wires.send']);
          if (has || viewOnly) { outS.people[k].push({ name: u.name || 'user', why: boss ? u.role.replace('_', ' ') : 'granted' }); }
          else if (!p1 && m[k] === true) { outS.people[k].push({ name: u.name || 'user', why: 'granted — but MISSING P1a ClickBooks access, so it does not work yet', broken: true }); }
        });
      });
      return NextResponse.json(outS);
    }

    if (action === 'set_bill_release') {
      var gRl = await perm(db, userId, ['wires.prepare', 'bills.manage'], req);
      if (!gRl) { return fail('Adding a release # here needs "Wires: Prepare" or "Bills: Manage".', 403); }
      var bidR = String(body.bill_id || ''); var relR = String(body.release_number || '').trim().toUpperCase().substring(0, 40);
      if (!isUuid(bidR) || relR.length < 2) { return fail('Type the release number.'); }
      var bR = await db.from('vendor_bills').select('id, release_number, record_status').eq('id', bidR).maybeSingle();
      if (bR.error || !bR.data) { return fail('Bill not found.', 404); }
      var onSent = await db.from('wire_package_lines').select('package_id').eq('bill_id', bidR).eq('is_open', true);
      var sentIds = ((onSent && onSent.data) || []).map(function (x) { return x.package_id; });
      if (sentIds.length) {
        var sp = await db.from('wire_packages').select('status').in('id', sentIds);
        if (((sp && sp.data) || []).some(function (x) { return x.status === 'sent'; })) { return fail('This bill is on a wire that was already SENT — its release cannot change now.', 409); }
      }
      var uR = await db.from('vendor_bills').update({ release_number: relR }).eq('id', bidR);
      if (uR.error) { return dbErr(uR.error); }
      await audit(db, userId, 'bill_release_set', 'vendor_bill', bidR, { from: bR.data.release_number || null, to: relR, via: 'wires' });
      return NextResponse.json({ ok: true, release_number: relR });
    }

    if (!isUuid(body.id)) { return fail('id required.'); }
    var P = await loadPackage(db, body.id);
    if (P.error) { return dbErr(P.error); }
    if (P.missing) { return fail('Wire not found.', 404); }
    var pkg = P.pkg;

    // ── everything about one wire
    if (action === 'get') {
      var fr = await db.from('wire_package_files').select('*').eq('package_id', pkg.id).order('uploaded_at', { ascending: true });
      var files = (fr && fr.data) || [];
      var nmG = await userNames(db, [pkg.created_by, pkg.checked_by, pkg.signoff1_by, pkg.signoff2_by, pkg.sent_by, pkg.attached_by, pkg.cancelled_by]
        .concat(files.map(function (f) { return f.uploaded_by; })).concat(P.ctx.lines.map(function (l) { return l.rtm.confirmed_by; })));
      var bank = null;
      if (pkg.bank_transaction_id) {
        var bt = await db.from('bank_transactions').select('id, date, posted_date, amount_abs, name, merchant_name, account_id').eq('id', pkg.bank_transaction_id).maybeSingle();
        if (bt && bt.data) { bank = { id: bt.data.id, date: bt.data.posted_date || bt.data.date, amount: r2(bt.data.amount_abs), name: bt.data.merchant_name || bt.data.name || '' }; }
      }
      var frozen = (pkg.status === 'sent' || pkg.status === 'attached');
      var t = packageTotals(pkg, P.ctx.lines);
      return NextResponse.json({ ok: true, package: {
        id: pkg.id, label: packageLabel(pkg), payee_kind: pkg.payee_kind, payee_name: pkg.payee_name, fee_amount: r2(pkg.fee_amount), fee_note: pkg.fee_note, memo: pkg.memo,
        status: P.status, raw_status: pkg.status, created_at: pkg.created_at, created_by: nmG[pkg.created_by] || null,
        bills_total: t.bills, total: t.total, approved_total: pkg.approved_total != null ? r2(pkg.approved_total) : null,
        sent: pkg.sent_by ? { by: nmG[pkg.sent_by] || 'user', at: pkg.sent_at, date: pkg.sent_date, reference: pkg.bank_reference } : null,
        attached: pkg.attached_by ? { by: nmG[pkg.attached_by] || 'user', at: pkg.attached_at, note: pkg.attach_note, bank: bank } : null,
        cancelled: pkg.cancelled_by ? { by: nmG[pkg.cancelled_by] || 'user', at: pkg.cancelled_at, note: pkg.cancel_note } : null,
        rtm_pending: P.rtmPending, paid_through: P.paidThrough },
        lines: P.ctx.lines.map(function (l) { return Object.assign({}, l, { rtm: Object.assign({}, l.rtm, { confirmed_by: l.rtm.confirmed_by ? (nmG[l.rtm.confirmed_by] || 'user') : null }) }); }),
        // after it is sent the checks shown are the ones the two people signed (frozen) — live re-checks would call its own payments "paid before"
        checks: frozen && pkg.check_result ? pkg.check_result : P.live, frozen_checks: !!(frozen && pkg.check_result),
        audit: { checked_at: pkg.checked_at, checked_by: nmG[pkg.checked_by] || null, stale: !frozen && !!pkg.check_hash && pkg.check_hash !== P.hash, ai_ok: pkg.ai_ok, ai_summary: pkg.ai_summary,
          i_signed_first: !!(pkg.signoff1_by && pkg.signoff1_by === userId && pkg.signoff1_hash === P.hash),
          signoff1: pkg.signoff1_by ? { name: nmG[pkg.signoff1_by] || 'user', at: pkg.signoff1_at, note: pkg.signoff1_note, valid: frozen || pkg.signoff1_hash === P.hash } : null,
          signoff2: pkg.signoff2_by ? { name: nmG[pkg.signoff2_by] || 'user', at: pkg.signoff2_at, note: pkg.signoff2_note, valid: frozen || (pkg.signoff2_hash === P.hash && pkg.signoff1_hash === P.hash) } : null },
        files: files.map(function (f) { return { id: f.id, kind: f.kind, path: f.path, file_name: f.file_name, by: nmG[f.uploaded_by] || null, at: f.uploaded_at }; }) });
    }

    // ── cancel a draft (never a sent wire — the money is gone)
    if (action === 'cancel') {
      var gC = await perm(db, userId, ['wires.prepare'], req);
      if (!gC) { return fail('Cancelling needs "Wires: Prepare".', 403); }
      if (pkg.status !== 'draft') { return fail('Only a wire that was not sent yet can be cancelled.', 409); }
      var noteC = String(body.note || '').trim().substring(0, 500);
      if (noteC.length < 3) { return fail('Say why it is cancelled.'); }
      var ulC = await db.from('wire_package_lines').update({ is_open: false }).eq('package_id', pkg.id);
      if (ulC.error) { return dbErr(ulC.error); }
      // (bills are only marked "paid through" when a wire is SENT — a cancelled draft changed nothing on them)
      var upC = await db.from('wire_packages').update({ status: 'cancelled', cancelled_by: userId, cancelled_at: nowIso(), cancel_note: noteC, updated_at: nowIso() }).eq('id', pkg.id).eq('status', 'draft').select('id');
      if (upC.error) { return dbErr(upC.error); }
      if (!upC.data || !upC.data.length) { return fail('Someone changed this wire meanwhile — reload it.', 409); }
      await audit(db, userId, 'wire_package_cancelled', 'wire_package', pkg.id, { note: noteC });
      return NextResponse.json({ ok: true });
    }

    // ── 🤖 audit + AI, saved against the fingerprint
    if (action === 'run_check') {
      var gR = await perm(db, userId, ['wires.prepare', 'wires.signoff'], req);
      if (!gR) { return fail('Running the audit needs "Wires: Prepare" or "Wires: Sign Off".', 403); }
      if (pkg.status !== 'draft') { return fail('This wire is ' + pkg.status + ' — its audit is frozen as signed.', 409); }
      var ai = await aiReviewPackage(pkg, P.ctx.lines, P.live, P.ctx);
      var upR = await db.from('wire_packages').update({ check_hash: P.hash, checked_at: nowIso(), checked_by: userId, check_result: P.live, check_pass: P.live.pass,
        ai_summary: ai.text, ai_ok: ai.ok, updated_at: nowIso() }).eq('id', pkg.id).eq('status', 'draft');
      if (upR.error) { return dbErr(upR.error); }
      await audit(db, userId, 'wire_package_audit_run', 'wire_package', pkg.id, { pass: P.live.pass, blocks: P.live.blocks, warns: P.live.warns, ai_ok: ai.ok, fingerprint: P.hash, total: P.live.total });
      return NextResponse.json({ ok: true, pass: P.live.pass, blocks: P.live.blocks, warns: P.live.warns, ai_ok: ai.ok });
    }

    // ── ✍ sign-off: 1st, then 2nd by a DIFFERENT person, on the exact audited fingerprint
    if (action === 'signoff') {
      var gS = await perm(db, userId, ['wires.signoff'], req);
      if (!gS) { return fail('Signing off needs "Wires: Sign Off" — Settings → 🏦 Banking & Accounting Access.', 403); }
      if (pkg.status !== 'draft') { return fail('This wire is already ' + pkg.status + '.', 409); }
      var noteS = String(body.note || '').trim().substring(0, 1000);
      if (!pkg.checked_at || pkg.check_hash !== P.hash) { return fail('Run the 🤖 audit first — the bills, amounts or fee changed since it ran (or it never ran).', 409); }
      if (pkg.check_pass !== true) { return fail('The audit found blocking problems — fix them and re-run the audit before anyone can sign.', 409); }
      if (pkg.ai_ok !== true && noteS.length < 10) { return fail(pkg.ai_ok === false ? 'The AI review raised concerns — write what you verified about them (at least 10 characters) to sign.' : 'The AI review did not run — write what you verified (at least 10 characters) to sign.'); }
      var s1ok = !!(pkg.signoff1_by && pkg.signoff1_hash === P.hash);
      var updS; var slot = 1;
      if (!s1ok) {
        updS = { signoff1_by: userId, signoff1_at: nowIso(), signoff1_note: noteS || null, signoff1_hash: P.hash, signoff2_by: null, signoff2_at: null, signoff2_note: null, signoff2_hash: null };
      } else {
        if (pkg.signoff2_by && pkg.signoff2_hash === P.hash) { return fail('This wire already has both sign-offs.', 409); }
        if (pkg.signoff1_by === userId) { return fail('You signed first — the second sign-off must be a DIFFERENT person.', 409); }
        slot = 2;
        updS = { signoff2_by: userId, signoff2_at: nowIso(), signoff2_note: noteS || null, signoff2_hash: P.hash };
      }
      updS.updated_at = nowIso();
      var su = await db.from('wire_packages').update(updS).eq('id', pkg.id).eq('status', 'draft').eq('updated_at', pkg.updated_at).select('id');
      if (su.error) { return fail(su.error.message + (/two_different/.test(su.error.message) ? ' — the same person cannot sign twice.' : ''), 400); }
      if (!su.data || !su.data.length) { return fail('Someone signed or changed this wire at the same moment — reload it and check again.', 409); }
      await audit(db, userId, slot === 1 ? 'wire_package_signoff_1' : 'wire_package_signoff_2', 'wire_package', pkg.id, { fingerprint: P.hash, note: noteS || null, total: P.live.total });
      return NextResponse.json({ ok: true, slot: slot, approved: slot === 2 });
    }

    // ── 📤 sent at the bank — the bank's wire confirmation is REQUIRED and becomes part of the approval record
    if (action === 'mark_sent') {
      var gT = await perm(db, userId, ['wires.send'], req);
      if (!gT) { return fail('Marking a wire sent needs "Wires: Send" — Settings → 🏦 Banking & Accounting Access.', 403); }
      if (P.status !== 'ready_to_send') { return fail(pkg.status === 'draft' ? 'Not approved yet: it needs a passing 🤖 audit on the current bills and BOTH sign-offs.' : 'This wire is already ' + pkg.status + '.', 409); }
      if (!isDate(body.sent_date)) { return fail('The date the wire was sent is required.'); }
      var refT = String(body.bank_reference || '').trim().substring(0, 80);
      if (refT.length < 3) { return fail("The bank's wire reference / confirmation number is required."); }
      var pathT = String(body.proof_path || '');
      if (pathT.indexOf('pv/wire-') !== 0) { return fail("Attach the bank's wire confirmation (PDF or screenshot) — it is part of the approval record."); }
      var fT = await db.from('wire_package_files').insert({ package_id: pkg.id, kind: 'bank_confirmation', path: pathT, file_name: String(body.proof_name || '').substring(0, 120) || null, uploaded_by: userId });
      if (fT.error) { return dbErr(fT.error); }
      var upT = await db.from('wire_packages').update({ status: 'sent', approved_total: P.live.total, sent_by: userId, sent_at: nowIso(), sent_date: body.sent_date, bank_reference: refT, updated_at: nowIso() })
        .eq('id', pkg.id).eq('status', 'draft').eq('updated_at', pkg.updated_at).select('id');
      if (upT.error) { return dbErr(upT.error); }
      if (!upT.data || !upT.data.length) { return fail('Someone changed this wire at the same moment — reload it and check again.', 409); }
      // v55.83-RJ (review gap 8) — the money has left: the bills ticked for an RTM / NextTrade wire are now "paid through" it
      var toMarkT = P.rawLines.filter(function (l) { return l.marked_paid_via === true; }).map(function (l) { return l.bill_id; });
      if (toMarkT.length && pkg.payee_kind !== 'vendor') {
        var mkT = await db.from('vendor_bills').update({ paid_via: pkg.payee_name }).in('id', toMarkT).is('paid_via', null);
        if (mkT.error) { await audit(db, userId, 'wire_package_mark_failed', 'wire_package', pkg.id, { error: mkT.error.message, bills: toMarkT }); }
        else { await audit(db, userId, 'bill_paid_via_set', 'wire_package', pkg.id, { paid_via: pkg.payee_name, bills: toMarkT }); }
      }
      await audit(db, userId, 'wire_package_sent', 'wire_package', pkg.id, { total: P.live.total, sent_date: body.sent_date, bank_reference: refT, proof: pathT });
      return NextResponse.json({ ok: true });
    }

    // ── bank lines that could be this wire: money out, same amount, around the sent date, not used yet
    if (action === 'bank_candidates') {
      if (pkg.status !== 'sent') { return fail('Only a sent wire waits for its bank line.', 409); }
      var d0 = new Date(pkg.sent_date + 'T00:00:00Z'); var dFrom = new Date(d0.getTime() - 3 * 86400000).toISOString().substring(0, 10); var dTo = new Date(d0.getTime() + 14 * 86400000).toISOString().substring(0, 10);
      var want = r2(pkg.approved_total);
      var tq = await db.from('bank_transactions').select('id, date, posted_date, amount_abs, direction, pending, name, merchant_name, wave_business_id, review_status')
        .eq('direction', 'out').eq('wave_business_id', US_WAVE_BUSINESS_ID).gte('date', dFrom).lte('date', dTo).limit(1000);
      if (tq.error) { return dbErr(tq.error); }
      var cands = (tq.data || []).filter(function (t) { return t.pending !== true && t.review_status !== 'duplicate' && Math.abs(r2(t.amount_abs) - want) <= Math.max(50, want * 0.02); });
      var cIds = cands.map(function (t) { return t.id; });
      var usedP = cIds.length ? await inChunks(db, 'vendor_bill_payments', 'bank_transaction_id, voided', 'bank_transaction_id', cIds) : [];
      var usedK = cIds.length ? await inChunks(db, 'wire_packages', 'bank_transaction_id', 'bank_transaction_id', cIds) : [];
      var used = {}; usedP.forEach(function (p) { if (p.voided !== true) { used[p.bank_transaction_id] = true; } }); usedK.forEach(function (k) { used[k.bank_transaction_id] = true; });
      var outC = cands.filter(function (t) { return !used[t.id]; }).map(function (t) {
        return { id: t.id, date: t.posted_date || t.date, amount: r2(t.amount_abs), name: t.merchant_name || t.name || '', exact: Math.abs(r2(t.amount_abs) - want) <= 0.005,
          looks_like_wire: /\bWIRE\b|\bWT\b|FEDWIRE|SWIFT/i.test(String(t.name || '') + ' ' + String(t.merchant_name || '')) };
      }).sort(function (a, b) { return (b.exact - a.exact) || (Math.abs(a.amount - want) - Math.abs(b.amount - want)); });
      return NextResponse.json({ ok: true, approved_total: want, candidates: outC.slice(0, 30), exact_one: outC.filter(function (c) { return c.exact; }).length === 1 });
    }

    // ── attach the bank line: the whole approval rides onto it and the bills are recorded paid NOW
    if (action === 'attach') {
      var gA = await perm(db, userId, ['wires.send'], req);
      if (!gA) { return fail('Attaching the bank line needs "Wires: Send".', 403); }
      if (pkg.status !== 'sent') { return fail(pkg.status === 'attached' ? 'Already attached.' : 'Mark the wire sent first.', 409); }
      var txA = String(body.bank_transaction_id || '');
      if (!isUuid(txA)) { return fail('Pick the bank line.'); }
      var tA = await db.from('bank_transactions').select('id, date, posted_date, amount_abs, direction, pending, wave_business_id, review_status, third_party_payer').eq('id', txA).maybeSingle();
      if (tA.error || !tA.data) { return fail('Bank transaction not found.', 404); }
      var t0 = tA.data;
      if (t0.direction !== 'out') { return fail('A wire is MONEY OUT — that bank line is money in.', 409); }
      if (t0.pending === true) { return fail('That bank line is still pending — attach it once it settles.', 409); }
      if (t0.wave_business_id !== US_WAVE_BUSINESS_ID) { return fail('That bank line is not on the US books.', 409); }
      if (t0.review_status === 'duplicate') { return fail('That bank line is marked a duplicate copy.', 409); }
      var usedA = await db.from('vendor_bill_payments').select('id, voided').eq('bank_transaction_id', txA);
      if ((usedA.data || []).some(function (p) { return p.voided !== true; })) { return fail('That bank line already pays other bills — pick the right line.', 409); }
      var diff = r2(r2(t0.amount_abs) - r2(pkg.approved_total));
      var noteA = String(body.override_note || '').trim().substring(0, 500);
      if (Math.abs(diff) > 0.005) {
        // the bank took a fee / FX moved: only a super admin, with the reason, may accept a different amount
        var isSup = !!(g1 && g1.ctx && (g1.ctx.isSuperAdmin || g1.ctx.role === 'owner'));
        if (!isSup) { return fail('The bank line is $' + r2(t0.amount_abs).toFixed(2) + ' but the approved wire is $' + r2(pkg.approved_total).toFixed(2) + ' (' + (diff > 0 ? '+' : '') + diff.toFixed(2) + '). Only a super admin or the owner can accept a different amount, with the reason.', 409); }
        if (noteA.length < 10) { return fail('Write why the amount differs (bank fee, FX…) — at least 10 characters.'); }
      }
      // bills paid NOW — with the same overpay guard as everywhere; nothing is written if any bill would be overpaid
      var billIdsA = P.rawLines.map(function (l) { return l.bill_id; });
      var paysA = await inChunks(db, 'vendor_bill_payments', 'bill_id, amount, voided', 'bill_id', billIdsA);
      for (var ai2 = 0; ai2 < P.rawLines.length; ai2++) {
        var la = P.rawLines[ai2]; var ba = P.ctx.billBy[la.bill_id] || {};
        var paidA = 0; paysA.forEach(function (p) { if (p.bill_id === la.bill_id && p.voided !== true) { paidA += Number(p.amount) || 0; } });
        if (ba.record_status !== 'active') { return fail((ba.vendor_name || 'A bill') + ' ' + (ba.bill_number || '') + ' was voided after approval — nothing was recorded. Sort it out first.', 409); }
        if (r2(la.amount) > r2((Number(ba.total_amount) || 0) - paidA) + 0.005) { return fail((ba.vendor_name || 'A bill') + ' ' + (ba.bill_number || '') + ' was paid some other way after approval — recording this wire would overpay it. Nothing was recorded.', 409); }
      }
      var payDate = t0.posted_date || t0.date;
      var method = pkg.payee_kind === 'vendor' ? 'wire' : 'rtm'; // 'rtm' = paid through a company (RTM / NextTrade): ONE line in the tax view, same as the 🏢 flow
      var made = [];
      for (var ai3 = 0; ai3 < P.rawLines.length; ai3++) {
        var lb = P.rawLines[ai3];
        var ip = await db.from('vendor_bill_payments').insert({ bill_id: lb.bill_id, amount: r2(lb.amount), paid_date: payDate, bank_transaction_id: txA, method: method, created_by: userId }).select('id').single();
        if (ip.error) {
          for (var rb = 0; rb < made.length; rb++) { await db.from('vendor_bill_payments').update({ voided: true }).eq('id', made[rb].payment_id); }
          return fail('Recording the bill payments failed (' + ip.error.message + ') — the ones already written were voided again; nothing changed.', 500);
        }
        made.push({ line_id: lb.id, payment_id: ip.data.id });
      }
      for (var ai4 = 0; ai4 < made.length; ai4++) {
        await db.from('wire_package_lines').update({ is_open: false, payment_id: made[ai4].payment_id }).eq('id', made[ai4].line_id);
      }
      var upA = await db.from('wire_packages').update({ status: 'attached', bank_transaction_id: txA, attached_by: userId, attached_at: nowIso(), attach_note: noteA || null, updated_at: nowIso() })
        .eq('id', pkg.id).eq('status', 'sent').select('id');
      if (upA.error || !upA.data || !upA.data.length) {
        for (var rb2 = 0; rb2 < made.length; rb2++) { await db.from('vendor_bill_payments').update({ voided: true }).eq('id', made[rb2].payment_id); }
        await db.from('wire_package_lines').update({ is_open: true, payment_id: null }).eq('package_id', pkg.id);
        return fail(((upA && upA.error && upA.error.message) || 'Someone attached this wire at the same moment') + ' — the bill payments were voided again; nothing changed.', 409);
      }
      // paid through RTM / NextTrade: the bank line is marked as that company's payment (books: one line; NextTrade = due-from, never an expense)
      var reviewed = false;
      if (pkg.payee_kind !== 'vendor') {
        await db.from('bank_transactions').update({ third_party_payer: pkg.payee_name }).eq('id', txA);
        if (pkg.payee_kind === 'affiliate') { try { reviewed = (await autoReviewIfComplete(db, [txA], userId)).length > 0; } catch (eR) { reviewed = false; } }
      }
      await audit(db, userId, 'wire_package_attached', 'wire_package', pkg.id, { bank_transaction_id: txA, bills: made.length, approved_total: r2(pkg.approved_total), bank_amount: r2(t0.amount_abs), difference: diff, override_note: noteA || null });
      await audit(db, userId, 'bill_payments_from_wire', 'bank_transaction', txA, { package: packageLabel(pkg), payments: made.map(function (m) { return m.payment_id; }) });
      return NextResponse.json({ ok: true, bills_paid: made.length, reviewed: reviewed });
    }

    // ── 📎 RTM's proof that it paid the vendors: one file can cover several bills
    if (action === 'rtm_proof') {
      var gQ = await perm(db, userId, ['wires.send', 'wires.prepare'], req);
      if (!gQ) { return fail('Adding RTM proof needs "Wires: Send" or "Wires: Prepare".', 403); }
      if (!P.paidThrough) { return fail('Proof of vendor payments is for wires through RTM (NextTrade wires have no proof step).', 409); }
      if (pkg.status !== 'sent' && pkg.status !== 'attached') { return fail('Proof comes after the wire is sent.', 409); }
      var lineIds = Array.isArray(body.line_ids) ? body.line_ids.filter(isUuid) : [];
      var mineIds = P.rawLines.map(function (l) { return l.id; });
      if (!lineIds.length || lineIds.some(function (x) { return mineIds.indexOf(x) < 0; })) { return fail('Tick the bills this proof covers.'); }
      if (!isDate(body.paid_date)) { return fail('The date RTM paid is required.'); }
      var pathQ = String(body.proof_path || '');
      if (pathQ.indexOf('pv/wire-') !== 0) { return fail("Attach RTM's proof (PDF or screenshot)."); }
      var fQ = await db.from('wire_package_files').insert({ package_id: pkg.id, kind: 'rtm_proof', path: pathQ, file_name: String(body.proof_name || '').substring(0, 120) || null, uploaded_by: userId }).select('id').single();
      if (fQ.error) { return dbErr(fQ.error); }
      var uq = await db.from('wire_package_lines').update({ rtm_paid_date: body.paid_date, rtm_reference: String(body.reference || '').trim().substring(0, 80) || null, rtm_file_id: fQ.data.id,
        rtm_confirmed_by: userId, rtm_confirmed_at: nowIso() }).eq('package_id', pkg.id).in('id', lineIds);
      if (uq.error) { return dbErr(uq.error); }
      await audit(db, userId, 'wire_package_rtm_proof', 'wire_package', pkg.id, { lines: lineIds.length, paid_date: body.paid_date, reference: body.reference || null, file: pathQ });
      return NextResponse.json({ ok: true, confirmed: lineIds.length });
    }

    return fail('Unknown action "' + action + '".');
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e && e.message) || 'Server error' }, { status: 500 });
  }
}
