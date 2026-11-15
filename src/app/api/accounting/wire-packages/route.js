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
import { auditPackage, packageFingerprint, packageStatus, packageTotals, packageLabel, normRef, samePayee, applyOverrides, checkKey, OVERRIDABLE, NOT_OVERRIDABLE_WHY } from '../../../../lib/wire-audit';
import { packageContext, inChunks, loadPayParties, aiReviewPackage } from '../../../../lib/wire-package-server';
import { attachWire, autoMatchSentWires, wireCandidates, AUTO_FEE_MAX } from '../../../../lib/wire-auto-match'; // v55.83-RZ

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
// v55.83-RY (Max, Nov 10 00:11: "should be able to view when you are signing off on a wire. you should be able to view each
// bill and close the bill as you check before you approve it and sign it") — each signer opens every bill and closes it as
// checked; the record is bound to THIS exact wire (its fingerprint): change the wire and the bills must be checked again.
async function billReviews(db, pkgId, hash) {
  var out = { byUser: {}, rows: [] };
  try {
    var r = await db.from('hub_audit_log').select('actor_id, details, created_at').eq('action', 'wire_bill_reviewed').eq('entity_id', String(pkgId));
    ((r && r.data) || []).forEach(function (h) {
      var d = h.details || {};
      if (!d.bill_id || d.fingerprint !== hash) { return; }
      (out.byUser[h.actor_id] = out.byUser[h.actor_id] || {})[d.bill_id] = h.created_at || d.at || true;
      out.rows.push({ bill_id: d.bill_id, by: h.actor_id, at: h.created_at || d.at || null });
    });
  } catch (e) { /* none */ }
  return out;
}

async function loadPackage(db, id) {
  var pr = await db.from('wire_packages').select('*').eq('id', id).maybeSingle();
  if (pr.error) { return { error: pr.error }; }
  if (!pr.data) { return { missing: true }; }
  var lr = await db.from('wire_package_lines').select('*').eq('package_id', id).order('created_at', { ascending: true });
  if (lr.error) { return { error: lr.error }; }
  var ctx = await packageContext(db, id, lr.data || []);
  var pkg = pr.data;
  var input = { pkg: pkg, lines: ctx.lines, sameRelease: ctx.sameRelease, sameNumber: ctx.sameNumber, sameOther: ctx.sameOther, knownReleases: ctx.knownReleases, otherOpen: ctx.otherOpen };
  var hash = packageFingerprint(pkg, ctx.lines);
  // v55.83-RL — approved overrides (who + why) for THIS exact wire turn their ⛔ into ↷; the rest still block
  var ovr = [];
  try { var orq = await db.from('wire_package_overrides').select('*').eq('package_id', id).order('overridden_at', { ascending: true }); if (!orq.error) { ovr = orq.data || []; } } catch (eOv) { ovr = []; }
  // once attached, the bills ARE paid by this wire — judge the frozen audit, not "paid before" by itself
  var live = applyOverrides(auditPackage(input), ovr, hash);
  // v55.83-RJ (review gap 6) — proof that the vendors were paid is asked from RTM-type companies only (NextTrade: bills only, no proof step)
  var paidThrough = pkg.payee_kind === 'service_provider';
  var rtmPending = paidThrough ? ctx.lines.filter(function (l) { return !l.rtm.confirmed_at; }).length : 0;
  return { pkg: pkg, rawLines: lr.data || [], ctx: ctx, input: input, live: live, hash: hash, overrides: ovr, status: packageStatus(pkg, hash, rtmPending), rtmPending: rtmPending, paidThrough: paidThrough };
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
          paid_via: b.paid_via || null, needs_mark: kindO !== 'vendor' && !b.paid_via, release_optional: kindO === 'affiliate',
          other_reference: b.other_reference || null, shipment_direction: b.shipment_direction || null, bill_type: b.bill_type || null };
      }).filter(function (b) { return b.open > 0.005; }).sort(function (a, b) { return (a.needs_mark - b.needs_mark) || String(a.due_date || a.bill_date || '').localeCompare(String(b.due_date || b.bill_date || '')); });
      // v55.83-RO (Max 20:54) — only VALIDATED bills are offered for a wire (plus any already on the wire being changed);
      // the open bills still waiting for validation are counted apart so nobody wonders where they went
      // v55.83-RZ — recording a PAST wire: those bills were paid before validation existed — every open bill is offered
      if (body.past === true && g1 && g1.ctx && g1.ctx.isSuperAdmin) { return NextResponse.json({ ok: true, bills: rowsO, not_validated: [] }); }
      var keepO = {}; openLines.forEach(function (l) { if (l.is_open && body.package_id && l.package_id === body.package_id) { keepO[l.bill_id] = true; } });
      var okO = rowsO.filter(function (b) { return b.validation_status === 'validated' || keepO[b.id]; });
      var waitO = rowsO.filter(function (b) { return b.validation_status !== 'validated' && !keepO[b.id] && !b.on_package; });
      return NextResponse.json({ ok: true, bills: okO, not_validated: waitO });
    }

    // ── list every package
    if (action === 'list') {
      var autoL = await autoMatchSentWires(db, { actorId: null, budgetMs: 8000 }); // RZ — sent wires whose bank line has arrived are matched first
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
          status: packageStatus(p, h, pend), rtm_pending: pend, overridden: 0, sent_date: p.sent_date, bank_reference: p.bank_reference,
          signers: [nm[p.signoff1_by], nm[p.signoff2_by]].filter(Boolean), signer_ids: [p.signoff1_by, p.signoff2_by].filter(Boolean) /* v55.83-SI — for the “Waiting for me” list */, bank_transaction_id: p.bank_transaction_id };
      });
      return NextResponse.json({ ok: true, packages: out, auto_matched: autoL.matched, auto_ambiguous: autoL.ambiguous });
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
      // v55.83-SC (Max Nov 12 09:40: "user can put additional funds to pay a service fee for RTM or nextrade and they can list that while building the wire")
      if (feeS > 0 && kindS === 'vendor') { return fail('A wire straight to a vendor is bills only — no fee.'); }
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
      var bS = await inChunks(db, 'vendor_bills', 'id, vendor_name, bill_number, total_amount, record_status, paid_via, validation_status', 'id', clean.map(function (c) { return c.bill_id; }));
      // v55.83-RO (Max 20:54: "only validated bills should be displayed for the bills that can be wired") — a bill is
      // ADDED to a wire only once validated; a bill already on this draft whose validation was reopened stays (the check blocks it)
      var alreadyOn = {};
      if (body.id) { var aoR = await db.from('wire_package_lines').select('bill_id, is_open').eq('package_id', body.id); ((aoR && aoR.data) || []).forEach(function (l) { if (l.is_open) { alreadyOn[l.bill_id] = true; } }); }
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
        if (bb.validation_status !== 'validated' && !alreadyOn[bb.id]) { return fail(whoB + ' is not validated yet — only validated bills can go on a wire. Validate it first (type of bill, inbound / outbound, 3 checks, how you verified it).', 409); }
        if (kindS !== 'vendor') {
          if (!bb.paid_via) { willMark[bb.id] = true; }
          else if (!samePayee(bb.paid_via, payeeS)) { return fail(whoB + ' is paid through ' + bb.paid_via + ' — it goes on THAT company\'s wire. Untick it.', 409); }
        } else if (bb.paid_via) { return fail(whoB + ' is paid through ' + bb.paid_via + ' — it goes on ' + bb.paid_via + '\'s wire, not straight to the vendor. Untick it.', 409); }
        var paidS = 0; pS.forEach(function (p) { if (p.bill_id === bb.id && p.voided !== true) { paidS += Number(p.amount) || 0; } });
        var openS = r2((Number(bb.total_amount) || 0) - paidS);
        if (clean[ci].amount > openS + 0.005) { return fail(whoB + ': $' + clean[ci].amount.toFixed(2) + ' is more than what is still owed ($' + openS.toFixed(2) + ').' + (openS <= 0.005 ? ' It is already paid — untick it.' : ''), 409); }
      }
      var pkgId = body.id || null; var editDiff = null;
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
        var oldHead = await db.from('wire_packages').select('payee_name, payee_kind, fee_amount, memo').eq('id', pkgId).maybeSingle();
        var oh = (oldHead && oldHead.data) || {};
        editDiff = { bills_added: [], bills_removed: [], amounts_changed: [] };
        if (oh.payee_name !== payeeS) { editDiff.payee = { from: oh.payee_name, to: payeeS }; }
        if (r2(oh.fee_amount) !== feeS) { editDiff.fee = { from: r2(oh.fee_amount), to: feeS }; }
        clean.forEach(function (c) { var o1 = oldBy[c.bill_id]; var bx = bSBy[c.bill_id] || {}; var lab = (bx.vendor_name || '') + ' ' + (bx.bill_number || '');
          if (!o1) { editDiff.bills_added.push({ bill: lab, amount: c.amount }); } else if (r2(o1.amount) !== c.amount) { editDiff.amounts_changed.push({ bill: lab, from: r2(o1.amount), to: c.amount }); } });
        (oldL.data || []).forEach(function (l) { if (!seenB[l.bill_id]) { editDiff.bills_removed.push({ bill_id: l.bill_id, amount: r2(l.amount) }); } });
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
      await audit(db, userId, body.id ? 'wire_package_updated' : 'wire_package_prepared', 'wire_package', pkgId, { payee: payeeS, kind: kindS, bills: clean.length, bills_total: totS.bills, fee: feeS, total: totS.total, will_mark_paid_via: Object.keys(willMark), changes: editDiff });
      return NextResponse.json({ ok: true, id: pkgId, total: totS.total, audit: autoA, will_mark: Object.keys(willMark).length });
    }

    // ── v55.83-RI (Max, Nov 9 10:34: "where the hell are all of the permisssioning and the setup?")
    // One readiness check: tables installed, who can do each step, bills ready to go on a wire, AI key.
    // ── v55.83-RZ (Max 00:20: "for those bills paid prior to this function — retroactively — ... you will look for the actual
    //    wire that was sent for that set of bills ... and match them") — RECORD A PAST WIRE: the bills it paid, who it went to,
    //    roughly when; the Hub then finds the bank line and records the bills PAID. Super admin only (no signatures existed).
    if (action === 'record_past_wire') {
      if (!(g1 && g1.ctx && g1.ctx.isSuperAdmin)) { return fail('Recording a past wire is for the super admin (it has no signatures).', 403); }
      var kindPW = String(body.payee_kind || ''); if (['service_provider', 'affiliate', 'vendor'].indexOf(kindPW) < 0) { return fail('Who did the wire go to — RTM, NextTrade or a vendor?'); }
      if (!isDate(body.sent_date)) { return fail('When was it sent (roughly)?'); }
      if (String(body.sent_date) > nowIso().substring(0, 10)) { return fail('That date is in the future — a past wire was already sent.'); } // v55.83-SB (bug review 4)
      var whyPW = String(body.reason || '').trim();
      if (whyPW.length < 10) { return fail('Say what this is (e.g. "June wire to RTM for these NexPac bills, before the Hub had wires") — at least 10 characters.'); }
      var inPW = Array.isArray(body.lines) ? body.lines : [];
      var cleanPW = []; var seenPW = {};
      for (var pw = 0; pw < inPW.length; pw++) {
        var bidPW = String(inPW[pw].bill_id || ''); var amPW = r2(String(inPW[pw].amount == null ? '' : inPW[pw].amount).replace(/,/g, ''));
        if (!isUuid(bidPW) || seenPW[bidPW]) { continue; } seenPW[bidPW] = true;
        if (!(amPW > 0)) { return fail('Every ticked bill needs the amount that wire paid.'); }
        cleanPW.push({ bill_id: bidPW, amount: amPW });
      }
      if (!cleanPW.length) { return fail('Tick the bills that wire paid.'); }
      var bPW = await inChunks(db, 'vendor_bills', 'id, vendor_name, bill_number, total_amount, record_status, paid_via', 'id', cleanPW.map(function (c) { return c.bill_id; }));
      var pPW = await inChunks(db, 'vendor_bill_payments', 'bill_id, amount, voided', 'bill_id', cleanPW.map(function (c) { return c.bill_id; }));
      var byPW = {}; bPW.forEach(function (b) { byPW[b.id] = b; });
      var payeePW = String(body.payee_name || '').trim();
      if (kindPW === 'vendor') { var vsPW = {}; bPW.forEach(function (b) { vsPW[normRef(b.vendor_name)] = b.vendor_name; }); if (Object.keys(vsPW).length !== 1) { return fail('A wire straight to a vendor pays ONE vendor — these bills belong to several.'); } payeePW = vsPW[Object.keys(vsPW)[0]]; }
      if (!payeePW) { return fail('Pick who the wire went to.'); }
      var markPW = {};
      for (var pc = 0; pc < cleanPW.length; pc++) {
        var bb2 = byPW[cleanPW[pc].bill_id];
        if (!bb2 || bb2.record_status !== 'active') { return fail('A ticked bill was not found or is void / deleted.', 404); }
        var paid2 = 0; pPW.forEach(function (p) { if (p.bill_id === bb2.id && p.voided !== true) { paid2 += Number(p.amount) || 0; } });
        if (cleanPW[pc].amount > r2((Number(bb2.total_amount) || 0) - paid2) + 0.005) { return fail(bb2.vendor_name + ' ' + (bb2.bill_number || '') + ' — only $' + r2((Number(bb2.total_amount) || 0) - paid2).toFixed(2) + ' is still open on it.', 409); }
        // v55.83-SB (bug review 4) — a bill paid through someone ELSE cannot go on this party's wire
        if (kindPW !== 'vendor' && bb2.paid_via && normRef(bb2.paid_via) !== normRef(payeePW)) { return fail(bb2.vendor_name + ' ' + (bb2.bill_number || '') + ' is paid through ' + bb2.paid_via + ', not ' + payeePW + ' — it cannot go on this wire.', 409); }
        if (kindPW !== 'vendor' && !bb2.paid_via) { markPW[bb2.id] = true; }
      }
      var totPW = r2(cleanPW.reduce(function (a, c) { return a + c.amount; }, 0));
      var insPW = await db.from('wire_packages').insert({ created_by: userId, payee_kind: kindPW, payee_name: payeePW, fee_amount: 0, status: 'draft', memo: whyPW.substring(0, 300) }).select('id, seq').single();
      if (insPW.error) { return dbErr(insPW.error); }
      var idPW = insPW.data.id;
      var lnPW = await db.from('wire_package_lines').insert(cleanPW.map(function (c) { return { package_id: idPW, bill_id: c.bill_id, amount: c.amount, marked_paid_via: markPW[c.bill_id] === true }; }));
      if (lnPW.error) { await db.from('wire_packages').delete().eq('id', idPW); return fail(/uq_wpkg_line_open_bill/.test(lnPW.error.message || '') ? 'One of these bills is already on another wire.' : lnPW.error.message, 409); }
      var stPW = await db.from('wire_packages').update({ status: 'sent', approved_total: totPW, sent_by: userId, sent_at: nowIso(), sent_date: body.sent_date, bank_reference: String(body.bank_reference || '').trim().substring(0, 80) || 'recorded after the fact',
        after_the_fact: true, after_the_fact_note: whyPW.substring(0, 500), updated_at: nowIso() }).eq('id', idPW).eq('status', 'draft').select('id');
      if (stPW.error || !stPW.data || !stPW.data.length) {
        await db.from('wire_package_lines').delete().eq('package_id', idPW); await db.from('wire_packages').delete().eq('id', idPW);
        return fail(((stPW && stPW.error && stPW.error.message) || 'not saved') + (stPW && stPW.error && /after_the_fact|wpkg_sent_complete/.test(stPW.error.message) ? ' — run sql/v55-83-RZ-wire-ready-sent-paid.sql first.' : '') + ' Nothing was kept.', 400);
      }
      var mkPW = Object.keys(markPW);
      if (mkPW.length) { var mk2 = await db.from('vendor_bills').update({ paid_via: payeePW }).in('id', mkPW).is('paid_via', null); if (!mk2.error) { await audit(db, userId, 'bill_paid_via_set', 'wire_package', idPW, { paid_via: payeePW, bills: mkPW }); } }
      await audit(db, userId, 'wire_recorded_after_the_fact', 'wire_package', idPW, { payee: payeePW, kind: kindPW, sent_date: body.sent_date, total: totPW, bills: cleanPW, reason: whyPW.substring(0, 500) });
      var mPW = await autoMatchSentWires(db, { packageId: idPW, actorId: userId });
      return NextResponse.json({ ok: true, id: idPW, label: packageLabel(insPW.data), total: totPW, matched: mPW.matched.length > 0, result: mPW });
    }

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
      // v55.83-RL — the same path also fills the bill's OTHER reference (BOL / PO / container…)
      // (Max 12:20) …and the INBOUND / OUTBOUND tick
      var fieldR = body.field === 'other_reference' ? 'other_reference' : body.field === 'shipment_direction' ? 'shipment_direction' : 'release_number';
      var bidR = String(body.bill_id || '');
      var relR = fieldR === 'shipment_direction' ? String(body.shipment_direction || '').toLowerCase()
        : String((fieldR === 'other_reference' ? body.other_reference : body.release_number) || '').trim().toUpperCase().substring(0, 60);
      if (!isUuid(bidR)) { return fail('Bill not recognised — reload.'); }
      if (fieldR === 'shipment_direction' && relR !== 'inbound' && relR !== 'outbound') { return fail('Pick inbound or outbound.'); }
      if (fieldR !== 'shipment_direction' && relR.length < 2) { return fail(fieldR === 'other_reference' ? 'Type the reference.' : 'Type the release number.'); }
      var bR = await db.from('vendor_bills').select('*').eq('id', bidR).maybeSingle();
      if (bR.error || !bR.data) { return fail('Bill not found.', 404); }
      // review #1 (v55.83-RV) — a VALIDATED bill: a missing release # / reference may be filled in, nothing validated may change
      if (bR.data.validation_status === 'validated') {
        if (fieldR === 'shipment_direction' && bR.data.shipment_direction && bR.data.shipment_direction !== relR) { return fail('This bill is VALIDATED as ' + bR.data.shipment_direction + ' — reopen its validation in 💸 Bills to change that.', 409); }
        if (fieldR !== 'shipment_direction' && String(bR.data[fieldR] || '').trim() && String(bR.data[fieldR]).trim().toUpperCase() !== relR) { return fail('This bill is VALIDATED with ' + (fieldR === 'other_reference' ? 'reference ' : 'release # ') + bR.data[fieldR] + ' — reopen its validation in 💸 Bills to change it.', 409); }
      }
      var onSent = await db.from('wire_package_lines').select('package_id').eq('bill_id', bidR).eq('is_open', true);
      var sentIds = ((onSent && onSent.data) || []).map(function (x) { return x.package_id; });
      if (sentIds.length) {
        var sp = await db.from('wire_packages').select('status').in('id', sentIds);
        if (((sp && sp.data) || []).some(function (x) { return x.status === 'sent'; })) { return fail('This bill is on a wire that was already SENT — its ' + (fieldR === 'other_reference' ? 'reference' : 'release') + ' cannot change now.', 409); }
      }
      var updR = {}; updR[fieldR] = relR;
      var uR = await db.from('vendor_bills').update(updR).eq('id', bidR);
      if (uR.error) { return fail(/other_reference|shipment_direction/.test(uR.error.message || '') ? 'Run sql/v55-83-RL-wire-override-delete-reference.sql first (reference / inbound-outbound columns).' : uR.error.message); }
      await audit(db, userId, fieldR === 'other_reference' ? 'bill_reference_set' : fieldR === 'shipment_direction' ? 'bill_direction_set' : 'bill_release_set', 'vendor_bill', bidR, { from: bR.data[fieldR] || null, to: relR, via: 'wires', vendor: bR.data.vendor_name, bill_number: bR.data.bill_number });
      return NextResponse.json({ ok: true, release_number: fieldR === 'release_number' ? relR : undefined, other_reference: fieldR === 'other_reference' ? relR : undefined, field: fieldR, value: relR });
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
      var hist = [];
      try { var hq = await db.from('hub_audit_log').select('at, actor_id, action, details').eq('entity', 'wire_package').eq('entity_id', String(pkg.id)).order('at', { ascending: true }).limit(500); if (!hq.error) { hist = hq.data || []; } } catch (eH) { hist = []; }
      var rvG = await billReviews(db, pkg.id, P.hash); // RY
      var rvNames = await userNames(db, rvG.rows.map(function (r) { return r.by; }));
      var nmG = await userNames(db, [pkg.created_by, pkg.checked_by, pkg.signoff1_by, pkg.signoff2_by, pkg.sent_by, pkg.attached_by, pkg.cancelled_by, pkg.reversed_by]
        .concat(files.map(function (f) { return f.uploaded_by; })).concat(P.ctx.lines.map(function (l) { return l.rtm.confirmed_by; }))
        .concat((P.overrides || []).map(function (o) { return o.overridden_by; })).concat(hist.map(function (h) { return h.actor_id; })));
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
        sent: pkg.sent_by ? { by: nmG[pkg.sent_by] || 'user', at: pkg.sent_at, date: pkg.sent_date, reference: pkg.bank_reference, after_the_fact: pkg.after_the_fact === true, after_the_fact_note: pkg.after_the_fact_note || null } : null,
        // RZ — a wire the Hub matched by itself has no person on it: say so
        attached: (pkg.attached_by || pkg.attached_at) ? { by: pkg.attached_by ? (nmG[pkg.attached_by] || 'user') : 'the Hub (automatically)', at: pkg.attached_at, note: pkg.attach_note, bank: bank, bank_fee: r2(pkg.bank_fee), auto: pkg.matched_auto === true } : null,
        cancelled: pkg.cancelled_by ? { by: nmG[pkg.cancelled_by] || 'user', at: pkg.cancelled_at, note: pkg.cancel_note } : null,
        reversed: pkg.reversed_by ? { by: nmG[pkg.reversed_by] || 'user', at: pkg.reversed_at, note: pkg.reverse_note } : null,
        rtm_pending: P.rtmPending, paid_through: P.paidThrough },
        lines: P.ctx.lines.map(function (l) { return Object.assign({}, l, { rtm: Object.assign({}, l.rtm, { confirmed_by: l.rtm.confirmed_by ? (nmG[l.rtm.confirmed_by] || 'user') : null }) }); }),
        // after it is sent the checks shown are the ones the two people signed (frozen) — live re-checks would call its own payments "paid before"
        checks: (function (res) {
          var named = Object.assign({}, res, { checks: (res.checks || []).map(function (c) {
            var c2 = Object.assign({}, c, { key: checkKey(c), overridable: OVERRIDABLE[c.code] === 1, why_not: NOT_OVERRIDABLE_WHY[c.code] || null });
            if (c2.override) { c2.override = Object.assign({}, c2.override, { by_name: nmG[c2.override.by] || 'user' }); }
            return c2;
          }) });
          return named;
        })(frozen && pkg.check_result ? pkg.check_result : P.live), frozen_checks: !!(frozen && pkg.check_result),
        overrides: (P.overrides || []).map(function (o) { return { code: o.code, bill_id: o.bill_id, text: o.check_text, reason: o.reason, by: nmG[o.overridden_by] || 'user', at: o.overridden_at, counts: o.fingerprint === P.hash || frozen }; }),
        history: hist.map(function (h) { return { at: h.at, by: nmG[h.actor_id] || (h.actor_id ? 'user' : 'system'), action: h.action, details: h.details }; }),
        audit: { checked_at: pkg.checked_at, checked_by: nmG[pkg.checked_by] || null, stale: !frozen && !!pkg.check_hash && pkg.check_hash !== P.hash, ai_ok: pkg.ai_ok, ai_summary: pkg.ai_summary,
          i_signed_first: !!(pkg.signoff1_by && pkg.signoff1_by === userId && pkg.signoff1_hash === P.hash),
          my_reviewed: Object.keys(rvG.byUser[userId] || {}),
          reviews: rvG.rows.map(function (r) { return { bill_id: r.bill_id, by: rvNames[r.by] || 'user', at: r.at, me: r.by === userId }; }),
          signoff1: pkg.signoff1_by ? { name: nmG[pkg.signoff1_by] || 'user', at: pkg.signoff1_at, note: pkg.signoff1_note, valid: frozen || pkg.signoff1_hash === P.hash } : null,
          signoff2: pkg.signoff2_by ? { name: nmG[pkg.signoff2_by] || 'user', at: pkg.signoff2_at, note: pkg.signoff2_note, valid: frozen || (pkg.signoff2_hash === P.hash && pkg.signoff1_hash === P.hash) } : null },
        files: files.map(function (f) { return { id: f.id, kind: f.kind, path: f.path, file_name: f.file_name, by: nmG[f.uploaded_by] || null, at: f.uploaded_at }; }) });
    }

    // ── v55.83-RY — a signer opened one bill and closed it as checked
    if (action === 'review_bill') {
      var gRv = await perm(db, userId, ['wires.signoff'], req);
      if (!gRv) { return fail('Checking bills for a sign-off needs "Wires: Sign Off".', 403); }
      if (pkg.status !== 'draft') { return fail('This wire is already ' + pkg.status + ' — nothing to sign.', 409); }
      var lnRv = P.ctx.lines.filter(function (l) { return l.bill_id === body.bill_id; })[0];
      if (!lnRv) { return fail('That bill is not on this wire.', 404); }
      await audit(db, userId, 'wire_bill_reviewed', 'wire_package', pkg.id, { bill_id: body.bill_id, fingerprint: P.hash, vendor: (lnRv.bill || {}).vendor_name, bill_number: (lnRv.bill || {}).bill_number, amount: lnRv.amount, note: String(body.note || '').substring(0, 300) || null });
      var rvA = await billReviews(db, pkg.id, P.hash);
      var mine = rvA.byUser[userId] || {};
      return NextResponse.json({ ok: true, reviewed: Object.keys(mine), left: P.ctx.lines.filter(function (l) { return !mine[l.bill_id]; }).length });
    }

    // ── v55.83-RL — OVERRIDE one ⛔ check (Max 12:17: "override button. with reason and audit of who approved it")
    if (action === 'override_check') {
      var gO = await perm(db, userId, ['wires.override'], req);
      if (!gO) { return fail('Overriding a check needs “Override wire checks” — Settings → 🏦 Banking & Accounting Access.', 403); }
      if (pkg.status !== 'draft') { return fail('This wire is ' + pkg.status + ' — its checks are frozen as signed.', 409); }
      var reasonO = String(body.reason || '').trim().substring(0, 1000);
      if (reasonO.length < 10) { return fail('Write the reason for the override (at least 10 characters) — it is kept with your name.'); }
      // the check must exist NOW on THIS wire, still blocking, and be one a person may judge
      var raw = auditPackage(P.input);
      var target = (raw.checks || []).filter(function (c) { return c.level === 'block' && checkKey(c) === String(body.check_key || ''); })[0];
      if (!target) { return fail('That problem is no longer on this wire (it changed) — reload it.', 409); }
      if (!OVERRIDABLE[target.code]) { return fail('This one cannot be overridden: ' + (NOT_OVERRIDABLE_WHY[target.code] || 'the books would refuse it') + '.', 409); }
      var insO = await db.from('wire_package_overrides').insert({ package_id: pkg.id, check_key: checkKey(target), code: target.code, bill_id: target.bill_id || null, check_text: target.text,
        reason: reasonO, overridden_by: userId, fingerprint: P.hash });
      if (insO.error) { return fail(/wire_package_overrides/.test(insO.error.message || '') ? 'Run sql/v55-83-RL-wire-override-delete-reference.sql first.' : insO.error.message); }
      // the stored check result follows (same fingerprint — signatures already given still count only if they were on this wire)
      var PO = await loadPackage(db, pkg.id);
      await db.from('wire_packages').update({ check_hash: PO.hash, checked_at: nowIso(), checked_by: userId, check_result: PO.live, check_pass: PO.live.pass, updated_at: nowIso() }).eq('id', pkg.id).eq('status', 'draft');
      await audit(db, userId, 'wire_check_overridden', 'wire_package', pkg.id, { code: target.code, bill_id: target.bill_id || null, check: target.text, reason: reasonO, fingerprint: P.hash, wire: packageLabel(pkg) });
      return NextResponse.json({ ok: true, pass: PO.live.pass, blocks: PO.live.blocks });
    }

    // ── v55.83-RL — DELETE a wire and put everything back (Max 12:17: "ability to delete the wire and everything return
    // to previous state"; 12:18: "audit should include ... deleted wire included or edited wire")
    //  • a DRAFT (never sent): erased; the audit log keeps a full snapshot of what it was.
    //  • a SENT / ATTACHED wire: super admin or owner, with the reason — the bill payments it recorded are voided, bills it
    //    marked "paid through" go back, the bank line gets its old label back and is free again; the wire is kept as
    //    "↩ reversed" (who sent it, who signed, who reversed it and why stay on record).
    if (action === 'delete_wire') {
      var reasonD = String(body.reason || '').trim().substring(0, 1000);
      var snap = { wire: packageLabel(pkg), status: pkg.status, payee: pkg.payee_name, kind: pkg.payee_kind, fee: r2(pkg.fee_amount), total: P.live.total, approved_total: pkg.approved_total,
        bills: P.ctx.lines.map(function (l) { return { bill_id: l.bill_id, vendor: l.bill.vendor_name, bill_number: l.bill.bill_number, release: l.bill.release_number || null, amount: l.amount }; }),
        signed_by: [pkg.signoff1_by, pkg.signoff2_by].filter(Boolean), sent: pkg.sent_by ? { by: pkg.sent_by, date: pkg.sent_date, reference: pkg.bank_reference } : null,
        bank_transaction_id: pkg.bank_transaction_id || null, overrides: (P.overrides || []).map(function (o) { return { code: o.code, reason: o.reason, by: o.overridden_by }; }) };
      if (pkg.status === 'draft' || pkg.status === 'cancelled') {
        var gD = await perm(db, userId, ['wires.prepare'], req);
        if (!gD) { return fail('Deleting a wire needs “Prepare wires”.', 403); }
        // v55.83-RZ (Max 00:18 + 00:22 "1 yes") — once BOTH signatures are in, only the super admin may delete it
        if (P.status === 'ready_to_send' && !(g1 && g1.ctx && g1.ctx.isSuperAdmin)) { return fail('This wire has both signatures — only the super admin can delete it now.', 403); }
        if (reasonD.length < 3) { return fail('Say why it is deleted.'); }
        if (pkg.status === 'cancelled') { return fail('A cancelled wire stays on record — nothing to put back.', 409); }
        await audit(db, userId, 'wire_package_deleted', 'wire_package', pkg.id, Object.assign({ reason: reasonD }, snap)); // the record survives the erase
        var dl = await db.from('wire_package_lines').delete().eq('package_id', pkg.id);
        if (dl.error) { return dbErr(dl.error); }
        var dp = await db.from('wire_packages').delete().eq('id', pkg.id).eq('status', 'draft');
        if (dp.error) { return dbErr(dp.error); }
        return NextResponse.json({ ok: true, erased: true });
      }
      if (pkg.status === 'reversed') { return fail('Already reversed.', 409); }
      var isBoss = !!(g1 && g1.ctx && g1.ctx.isSuperAdmin); // v55.83-SB (Max Nov 12 09:31, question 2: "yes") — the super admin only, not the owner
      if (!isBoss) { return fail('A wire that was already sent can only be undone by the super admin.', 403); }
      if (reasonD.length < 10) { return fail('Write why this sent wire is being undone (at least 10 characters).'); }
      // review #16 (v55.83-RV) — never half-undone: the 'reversed' record must be storable BEFORE anything is voided or freed
      var revChk = await db.from('wire_packages').select('id, reversed_by, reversed_at, reverse_note').eq('id', pkg.id).maybeSingle();
      if (revChk.error) { return fail('Undo is not set up in the database yet — run sql/v55-83-RL-wire-override-delete-reference.sql first. Nothing was changed.', 400); }
      var undone = { payments_voided: [], bills_unmarked: [], bank_line_restored: false };
      // 1) the payments this wire recorded
      for (var ri = 0; ri < P.rawLines.length; ri++) {
        var rl = P.rawLines[ri];
        if (rl.payment_id) {
          var vpR = await db.from('vendor_bill_payments').update({ voided: true }).eq('id', rl.payment_id);
          if (vpR.error) { return fail('Could not void a payment (' + vpR.error.message + ') — nothing else was changed after it; try again.', 500); }
          undone.payments_voided.push(rl.payment_id);
        }
      }
      // 2) bills this wire marked "paid through" go back (only if still marked for this company)
      var toUnmark = P.rawLines.filter(function (l) { return l.marked_paid_via === true; }).map(function (l) { return l.bill_id; });
      if (toUnmark.length) { await db.from('vendor_bills').update({ paid_via: null }).in('id', toUnmark).eq('paid_via', pkg.payee_name); undone.bills_unmarked = toUnmark; }
      // 3) the bank line: back to its old label, free for another match
      if (pkg.bank_transaction_id && pkg.payee_kind !== 'vendor') {
        await db.from('bank_transactions').update({ third_party_payer: pkg.prev_third_party_payer || null }).eq('id', pkg.bank_transaction_id).eq('third_party_payer', pkg.payee_name);
        undone.bank_line_restored = true;
      }
      // 4) lines closed, the wire kept on record as reversed
      await db.from('wire_package_lines').update({ is_open: false }).eq('package_id', pkg.id);
      var upR = await db.from('wire_packages').update({ status: 'reversed', reversed_by: userId, reversed_at: nowIso(), reverse_note: reasonD, bank_transaction_id: null, updated_at: nowIso() }).eq('id', pkg.id).in('status', ['sent', 'attached']).select('id');
      if (upR.error) { return fail(/reverse|status_check/.test(upR.error.message || '') ? 'Run sql/v55-83-RL-wire-override-delete-reference.sql first — ' + upR.error.message : upR.error.message, 400); }
      await audit(db, userId, 'wire_package_reversed', 'wire_package', pkg.id, Object.assign({ reason: reasonD, undone: undone }, snap));
      if (pkg.bank_transaction_id) { await audit(db, userId, 'bill_payments_voided_by_wire_undo', 'bank_transaction', pkg.bank_transaction_id, { wire: packageLabel(pkg), payments: undone.payments_voided, reason: reasonD }); }
      return NextResponse.json({ ok: true, reversed: true, undone: undone });
    }

    // ── cancel a draft (never a sent wire — the money is gone)
    if (action === 'cancel') {
      var gC = await perm(db, userId, ['wires.prepare'], req);
      if (!gC) { return fail('Cancelling needs "Wires: Prepare".', 403); }
      if (pkg.status !== 'draft') { return fail('Only a wire that was not sent yet can be cancelled.', 409); }
      if (P.status === 'ready_to_send' && !(g1 && g1.ctx && g1.ctx.isSuperAdmin)) { return fail('This wire has both signatures — only the super admin can cancel it now.', 403); } // RZ
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
      var rvS = await billReviews(db, pkg.id, P.hash); var mineS = rvS.byUser[userId] || {}; // RY
      var notSeen = P.ctx.lines.filter(function (l) { return !mineS[l.bill_id]; });
      if (notSeen.length) { return fail('Open and check every bill before you sign — ' + notSeen.length + ' not checked yet: ' + notSeen.map(function (l) { return ((l.bill || {}).vendor_name || '?') + ' ' + ((l.bill || {}).bill_number || ''); }).join(', ') + '.', 409); }
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
      var cw = await wireCandidates(db, pkg, { before: 3, after: 14, wide: true });
      if (cw.error) { return fail(cw.error, 500); }
      var outC = cw.list.map(function (c) { return { id: c.id, date: c.date, amount: c.amount, fee: c.fee, name: c.name, exact: c.exact, looks_like_wire: c.looks_like_wire }; });
      return NextResponse.json({ ok: true, approved_total: cw.want, candidates: outC.slice(0, 30), exact_one: outC.filter(function (c) { return c.exact; }).length === 1, auto_fee_max: AUTO_FEE_MAX });
    }

    // ── attach the bank line: the whole approval rides onto it and the bills are recorded paid NOW
    if (action === 'attach') {
      var gA = await perm(db, userId, ['wires.send'], req);
      if (!gA) { return fail('Attaching the bank line needs "Wires: Send".', 403); }
      var txA = String(body.bank_transaction_id || '');
      if (!isUuid(txA)) { return fail('Pick the bank line.'); }
      var tA = await db.from('bank_transactions').select('id, date, posted_date, amount_abs, direction, pending, wave_business_id, review_status, third_party_payer').eq('id', txA).maybeSingle();
      if (tA.error || !tA.data) { return fail('Bank transaction not found.', 404); }
      // more than a $50 extra charge (or less than the wire): only a super admin / the owner, with the reason
      var isSupA = !!(g1 && g1.ctx && (g1.ctx.isSuperAdmin || g1.ctx.role === 'owner'));
      var noteA = String(body.override_note || '').trim().substring(0, 500);
      var diffA = r2(r2(tA.data.amount_abs) - r2(pkg.approved_total));
      var bigDiff = Math.abs(diffA) > 0.005 && !(diffA > 0 && diffA <= AUTO_FEE_MAX + 0.005);
      if (bigDiff && isSupA && noteA.length < 10) { return fail('Write why the amount differs (intermediary bank charge, FX…) — at least 10 characters.'); }
      var at = await attachWire(db, pkg, tA.data, userId, { allowDifferent: bigDiff && isSupA, note: noteA || null });
      if (!at.ok) { return fail(at.error, at.status || 409); }
      return NextResponse.json({ ok: true, bills_paid: at.bills_paid, bank_fee: at.bank_fee, reviewed: at.reviewed });
    }

    // ── v55.83-RZ — look for this wire's bank line now (the same engine runs by itself on every bank sync)
    if (action === 'match_now') {
      if (pkg.status !== 'sent') { return fail('Only a sent wire waits for its bank line.', 409); }
      var mn = await autoMatchSentWires(db, { packageId: pkg.id, actorId: userId });
      return NextResponse.json({ ok: true, matched: mn.matched.length > 0, result: mn });
    }

    // ── v55.83-RZ (Max 00:20: "we should be able to update the date of the wire and you will look for the actual wire") —
    //    correct the sent date of a SENT wire (before its bank line is attached), then search around the new date
    if (action === 'set_sent_date') {
      var gD2 = await perm(db, userId, ['wires.send'], req);
      if (!gD2) { return fail('Changing the sent date needs "Wires: Send".', 403); }
      if (pkg.status !== 'sent') { return fail(pkg.status === 'attached' ? 'Its bank line is already attached — the date is the bank line’s date.' : 'Only a sent wire has a sent date.', 409); }
      if (!isDate(body.sent_date)) { return fail('Pick the date the wire was sent.'); }
      var why2 = String(body.reason || '').trim();
      if (why2.length < 5) { return fail('Say why the date changes (e.g. sent on the 12th, not the 10th).'); }
      var ud = await db.from('wire_packages').update({ sent_date: body.sent_date, updated_at: nowIso() }).eq('id', pkg.id).eq('status', 'sent').select('id');
      if (ud.error) { return fail(ud.error.message + (/LOCKED/.test(ud.error.message) ? ' — run sql/v55-83-RZ-wire-ready-sent-paid.sql to allow correcting the date.' : ''), 400); }
      await audit(db, userId, 'wire_sent_date_changed', 'wire_package', pkg.id, { from: pkg.sent_date, to: body.sent_date, reason: why2.substring(0, 300) });
      var mn2 = await autoMatchSentWires(db, { packageId: pkg.id, actorId: userId });
      return NextResponse.json({ ok: true, matched: mn2.matched.length > 0, result: mn2 });
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
