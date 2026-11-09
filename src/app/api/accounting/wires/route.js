// v55.83-RG — 🏦 Wires portal (Max, Nov 8 15:32): "we need a separate portal
// for wires sent. So when a wire is sent to a vendor... we already link the
// bills to the wire.. but there needs to be a quick audit that they were not
// paid previously and that they all belong to a release number - make sure
// there are no duplicated release numbers or reference numbers. and then a
// manual signoff by 2 people who have verified the wire. so an AI validation
// and then 2 further validations manually and then clicking on wire will bring
// about all the bills paid with all of their data."
//
// A "wire" = an outgoing bank transaction with bills linked to it. Steps:
//   1. 🤖 audit — the rule checks (lib/wire-audit) + an AI review, saved with
//      the fingerprint of exactly what was checked;
//   2. ✍ 1st sign-off, 3. ✍ 2nd sign-off by a DIFFERENT person — both bound
//      to that fingerprint (bills change → sign-offs stop counting).
// Permissions: ClickBooks (KTC Hub) Access + Wires: View to see; Wires: Sign
// Off to sign; Bills: Manage to fill a missing release number. Every step is
// written to the append-only audit trail.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { assertPermission } from '../../../../lib/server-permissions';
import { audit } from '../../../../lib/audit-server';
import { auditWire, wireFingerprint, wireStatus, normRef, packageLabel } from '../../../../lib/wire-audit';
import { US_WAVE_BUSINESS_ID } from '../../../../lib/business-of';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function admin() { return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } }); }
function r2(x) { return Math.round((Number(x) || 0) * 100) / 100; }
function chunk(arr, n) { var out = []; for (var i = 0; i < arr.length; i += n) { out.push(arr.slice(i, i + n)); } return out; }

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
async function inChunks(db, table, cols, col, ids) {
  var out = [];
  var parts = chunk(ids, 200);
  for (var i = 0; i < parts.length; i++) {
    var r = await db.from(table).select(cols).in(col, parts[i]);
    if (!r.error && r.data) { out = out.concat(r.data); }
  }
  return out;
}

// Everything the audit needs for a set of wires (bank transaction ids).
async function gather(db, txIds) {
  var pays = await inChunks(db, 'vendor_bill_payments', 'id, bill_id, amount, paid_date, bank_transaction_id, method, voided', 'bank_transaction_id', txIds);
  pays = pays.filter(function (p) { return p.voided !== true; });
  var billIds = []; pays.forEach(function (p) { if (billIds.indexOf(p.bill_id) < 0) { billIds.push(p.bill_id); } });
  var bills = billIds.length ? await inChunks(db, 'vendor_bills', '*', 'id', billIds) : [];
  var billBy = {}; bills.forEach(function (b) { billBy[b.id] = b; });
  // every OTHER payment ever made on these bills (to catch "paid previously")
  var allPays = billIds.length ? await inChunks(db, 'vendor_bill_payments', 'id, bill_id, amount, paid_date, bank_transaction_id, method, voided', 'bill_id', billIds) : [];
  allPays = allPays.filter(function (p) { return p.voided !== true; });
  // other active bills sharing a release / reference number
  var rels = []; var nums = [];
  bills.forEach(function (b) {
    var rl = normRef(b.release_number); if (rl && rels.indexOf(rl) < 0) { rels.push(rl); }
    var nm = String(b.bill_number || '').trim(); if (nm && nums.indexOf(nm) < 0) { nums.push(nm); }
  });
  var sameRelease = {}; var sameNumber = {};
  if (rels.length) {
    var rb = await inChunks(db, 'vendor_bills', 'id, vendor_name, bill_number, release_number, record_status', 'release_number', rels);
    rb.forEach(function (b) { if (b.record_status !== 'active') { return; } var k = normRef(b.release_number); (sameRelease[k] = sameRelease[k] || []).push({ bill_id: b.id, vendor_name: b.vendor_name, bill_number: b.bill_number }); });
  }
  if (nums.length) {
    var nb = await inChunks(db, 'vendor_bills', 'id, vendor_name, bill_number, record_status', 'bill_number', nums);
    nb.forEach(function (b) { if (b.record_status !== 'active') { return; } var k = normRef(b.bill_number); (sameNumber[k] = sameNumber[k] || []).push({ bill_id: b.id, vendor_name: b.vendor_name }); });
  }
  // releases known to the business (warehouse orders + invoices)
  var known = [];
  if (rels.length) {
    try {
      var o1 = await inChunks(db, 'nexttrade_orders', 'release_number', 'release_number', rels);
      o1.forEach(function (x) { known.push(x.release_number); });
    } catch (eO) { /* table may be absent — fewer "known" hits, never a block */ }
    try {
      var o2 = await inChunks(db, 'accounting_invoices', 'release_number', 'release_number', rels);
      o2.forEach(function (x) { known.push(x.release_number); });
    } catch (eI) { /* fail-soft */ }
  }
  var txs = await inChunks(db, 'bank_transactions', 'id, date, posted_date, amount_abs, direction, name, merchant_name, account_id, review_status, wave_business_id', 'id', txIds);
  var txBy = {}; txs.forEach(function (t) { txBy[t.id] = t; });
  var payByTx = {}; pays.forEach(function (p) { (payByTx[p.bank_transaction_id] = payByTx[p.bank_transaction_id] || []).push(p); });
  var otherLabel = {};
  var otherTxIds = []; allPays.forEach(function (p) { if (p.bank_transaction_id && txIds.indexOf(p.bank_transaction_id) < 0 && otherTxIds.indexOf(p.bank_transaction_id) < 0) { otherTxIds.push(p.bank_transaction_id); } });
  if (otherTxIds.length) {
    var ot = await inChunks(db, 'bank_transactions', 'id, date, posted_date, name, merchant_name', 'id', otherTxIds);
    ot.forEach(function (t) { otherLabel[t.id] = 'bank ' + (t.posted_date || t.date) + ' ' + String(t.merchant_name || t.name || '').substring(0, 40); });
  }
  function build(txId) {
    var t = txBy[txId] || { id: txId };
    var wire = { id: txId, amount: r2(t.amount_abs), date: t.posted_date || t.date, direction: t.direction, name: t.merchant_name || t.name || '' };
    var lines = (payByTx[txId] || []).map(function (p) {
      var others = allPays.filter(function (o) { return o.bill_id === p.bill_id && o.id !== p.id && o.bank_transaction_id !== txId; })
        .map(function (o) { return { amount: r2(o.amount), paid_date: o.paid_date, bank_transaction_id: o.bank_transaction_id || null, label: o.bank_transaction_id ? (otherLabel[o.bank_transaction_id] || 'another bank payment') : (o.method ? 'recorded ' + o.method : 'recorded payment') }; });
      return { payment_id: p.id, bill_id: p.bill_id, amount: r2(p.amount), method: p.method || null, bill: billBy[p.bill_id] || {}, other_payments: others };
    });
    return { wire: wire, txn: t, lines: lines, sameRelease: sameRelease, sameNumber: sameNumber, knownReleases: known };
  }
  return { build: build, txBy: txBy };
}

async function userNames(db, ids) {
  var out = {}; var want = ids.filter(function (x, i, a) { return x && a.indexOf(x) === i; });
  if (!want.length) { return out; }
  var u = await db.from('users').select('id, name').in('id', want);
  ((u && u.data) || []).forEach(function (r) { out[r.id] = r.name || 'user'; });
  return out;
}

async function aiReview(input, rules) {
  var key = process.env.ANTHROPIC_API_KEY;
  if (!key) { return { ok: null, text: 'AI review unavailable — ANTHROPIC_API_KEY is not set. The rule checks above still ran.' }; }
  var compact = { wire: input.wire, bills: input.lines.map(function (l) {
    var b = l.bill || {};
    return { vendor: b.vendor_name, bill_number: b.bill_number, release: b.release_number, bill_date: b.bill_date, due: b.due_date, total: b.total_amount,
      paid_by_this_wire: l.amount, paid_before: l.other_payments, category: b.category, notes: String(b.notes || '').substring(0, 200), validation: b.validation_status };
  }), rule_results: rules.checks };
  var prompt = 'You are the first reviewer of an outgoing vendor WIRE for a trading company. The company requires: no bill paid twice, every bill belongs to a release number, ' +
    'no duplicated release or reference numbers, and the bills must explain the wire. Automatic rule checks already ran (rule_results). Look for anything ELSE a careful ' +
    'accountant would question: vendor on the bills vs the bank description, dates (bill after the wire, very old bills), amounts that look like typos, the same document billed ' +
    'under two vendors, a release whose bills look inconsistent. Never invent facts that are not in the data. Reply in plain text: the FIRST line is exactly OK or CONCERNS, then ' +
    'at most 6 short lines, each one concern or confirmation.\n\nDATA:\n' + JSON.stringify(compact).substring(0, 24000);
  var models = ['claude-sonnet-4-6', 'claude-haiku-4-5']; var lastErr = null;
  for (var mi = 0; mi < models.length; mi++) {
    try {
      var resp = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: models[mi], max_tokens: 500, messages: [{ role: 'user', content: prompt }] }) });
      var aj = await resp.json();
      if (aj && aj.error) { throw new Error(aj.error.message || 'model error'); }
      var txt = ((aj && aj.content) || []).filter(function (c) { return c.type === 'text'; }).map(function (c) { return c.text; }).join('\n').trim();
      if (!txt) { throw new Error('empty answer'); }
      var first = txt.split('\n')[0].trim().toUpperCase();
      return { ok: first.indexOf('OK') === 0, text: txt.substring(0, 2000) };
    } catch (e) { lastErr = e; }
  }
  return { ok: null, text: 'AI review unavailable — ' + ((lastErr && lastErr.message) || 'no answer') + '. The rule checks above still ran.' };
}

export async function POST(req) {
  try {
    var body = await req.json();
    var action = body.action;
    var db = admin();
    var userId = body.user_id || null;
    var g1 = await assertPermission(db, userId, 'accounting.clickbooks.access', req);
    if (!g1.ok) { return NextResponse.json({ ok: false, error: 'This needs "P1a · ClickBooks (KTC Hub) Access" — Settings → Permissions.' }, { status: g1.status || 403 }); }
    var g2 = await assertPermission(db, userId, 'wires.view', req);
    if (!g2.ok) { g2 = await assertPermission(db, userId, 'wires.signoff', req); } // a signer can always see what they sign
    if (!g2.ok) { g2 = await assertPermission(db, userId, 'wires.prepare', req); } // v55.83-RH
    if (!g2.ok) { g2 = await assertPermission(db, userId, 'wires.send', req); } // v55.83-RH
    if (!g2.ok) { return NextResponse.json({ ok: false, error: 'This needs "Wires: View" — Settings → Permissions.' }, { status: g2.status || 403 }); }

    // ── list: every outgoing bank payment with bills linked
    if (action === 'list') {
      var from = /^\d{4}-\d{2}-\d{2}$/.test(String(body.from || '')) ? body.from : '2026-01-01';
      var to = /^\d{4}-\d{2}-\d{2}$/.test(String(body.to || '')) ? body.to : new Date().toISOString().substring(0, 10);
      var pp = await pageAll(function () { return db.from('vendor_bill_payments').select('id, bank_transaction_id, voided').not('bank_transaction_id', 'is', null); });
      if (pp.error) { return NextResponse.json({ ok: false, error: pp.error.message }, { status: 400 }); }
      var txIds = [];
      pp.data.forEach(function (p) { if (p.voided !== true && txIds.indexOf(p.bank_transaction_id) < 0) { txIds.push(p.bank_transaction_id); } });
      var G = await gather(db, txIds);
      var ids2 = txIds.filter(function (id) { var t = G.txBy[id]; var d = t && (t.posted_date || t.date); return t && t.wave_business_id === US_WAVE_BUSINESS_ID && t.direction === 'out' && d >= from && d <= to; });
      var aud = ids2.length ? await inChunks(db, 'wire_audits', '*', 'bank_transaction_id', ids2) : [];
      var audBy = {}; aud.forEach(function (a) { audBy[a.bank_transaction_id] = a; });
      var rows = ids2.map(function (id) {
        var inp = G.build(id); var hash = wireFingerprint(inp.wire, inp.lines);
        var vend = []; inp.lines.forEach(function (l) { var v = (l.bill && l.bill.vendor_name) || '?'; if (vend.indexOf(v) < 0) { vend.push(v); } });
        var placed = 0; inp.lines.forEach(function (l) { placed = r2(placed + l.amount); });
        var a = audBy[id] || null;
        return { id: id, date: inp.wire.date, name: inp.wire.name, amount: inp.wire.amount, bills: inp.lines.length, placed: placed, vendors: vend,
          looks_like_wire: /\bWIRE\b|\bWT\b|FEDWIRE|SWIFT/i.test(inp.wire.name), status: wireStatus(a, hash),
          signoff1_by: a && a.signoff1_hash === hash ? a.signoff1_by : null, signoff2_by: a && a.signoff2_hash === hash ? a.signoff2_by : null };
      }).sort(function (x, y) { return String(y.date).localeCompare(String(x.date)); });
      // v55.83-RH — a bank line that came from a wire APPROVED BEFORE SENDING carries its package; any other is flagged "sent without approval"
      var pkgBy = {};
      try {
        var pkR = ids2.length ? await inChunks(db, 'wire_packages', 'id, seq, bank_transaction_id, status', 'bank_transaction_id', ids2) : [];
        pkR.forEach(function (k) { pkgBy[k.bank_transaction_id] = { id: k.id, label: packageLabel(k) }; });
      } catch (ePk) { /* RH SQL not run yet */ }
      rows.forEach(function (r) { r.package = pkgBy[r.id] || null; });
      var nm = await userNames(db, [].concat(rows.map(function (r) { return r.signoff1_by; }), rows.map(function (r) { return r.signoff2_by; })));
      rows.forEach(function (r) { r.signoff1_name = r.signoff1_by ? nm[r.signoff1_by] : null; r.signoff2_name = r.signoff2_by ? nm[r.signoff2_by] : null; });
      return NextResponse.json({ ok: true, from: from, to: to, wires: rows });
    }

    var txId = String(body.bank_transaction_id || '');
    if (!/^[0-9a-f-]{36}$/i.test(txId) && action !== 'set_release') { return NextResponse.json({ ok: false, error: 'bank_transaction_id required.' }, { status: 400 }); }

    // ── detail: the wire + every bill it paid, with all their data, the live checks and the sign-offs
    if (action === 'detail') {
      var Gd = await gather(db, [txId]);
      var inp = Gd.build(txId);
      if (!Gd.txBy[txId]) { return NextResponse.json({ ok: false, error: 'Bank transaction not found.' }, { status: 404 }); }
      var hash = wireFingerprint(inp.wire, inp.lines);
      var live = auditWire(inp);
      var ar = await db.from('wire_audits').select('*').eq('bank_transaction_id', txId).maybeSingle();
      var row = (ar && !ar.error && ar.data) || null;
      var names = await userNames(db, [row && row.signoff1_by, row && row.signoff2_by, row && row.checked_by]);
      var accR = await db.from('plaid_accounts').select('name, mask').eq('plaid_account_id', Gd.txBy[txId].account_id).maybeSingle();
      return NextResponse.json({ ok: true, wire: inp.wire, account: accR && accR.data ? ((accR.data.name || '') + (accR.data.mask ? ' •' + accR.data.mask : '')) : null,
        lines: inp.lines, checks: live, fingerprint: hash, status: wireStatus(row, hash),
        audit: row ? { checked_at: row.checked_at, checked_by: names[row.checked_by] || null, stale: row.check_hash !== hash, check_pass: row.check_pass, ai_ok: row.ai_ok, ai_summary: row.ai_summary,
          signoff1: row.signoff1_by ? { name: names[row.signoff1_by] || 'user', at: row.signoff1_at, note: row.signoff1_note, valid: row.signoff1_hash === hash, by: row.signoff1_by } : null,
          signoff2: row.signoff2_by ? { name: names[row.signoff2_by] || 'user', at: row.signoff2_at, note: row.signoff2_note, valid: row.signoff2_hash === hash && row.signoff1_hash === hash, by: row.signoff2_by } : null } : null,
        sql_missing: !!(ar && ar.error) });
    }

    // ── run_check: rules + AI, saved against the fingerprint
    if (action === 'run_check') {
      var Gc = await gather(db, [txId]);
      var inpc = Gc.build(txId);
      if (!Gc.txBy[txId]) { return NextResponse.json({ ok: false, error: 'Bank transaction not found.' }, { status: 404 }); }
      var hc = wireFingerprint(inpc.wire, inpc.lines);
      var rc = auditWire(inpc);
      var ai = await aiReview(inpc, rc);
      var ex = await db.from('wire_audits').select('id').eq('bank_transaction_id', txId).maybeSingle();
      if (ex && ex.error) { return NextResponse.json({ ok: false, error: ex.error.message + ' — run sql/v55-83-RG-wires-recon.sql first.' }, { status: 400 }); }
      var patch = { bank_transaction_id: txId, check_hash: hc, checked_at: new Date().toISOString(), checked_by: userId, check_result: rc, check_pass: rc.pass, ai_summary: ai.text, ai_ok: ai.ok, updated_at: new Date().toISOString() };
      var sv = ex && ex.data ? await db.from('wire_audits').update(patch).eq('id', ex.data.id) : await db.from('wire_audits').insert(patch);
      if (sv.error) { return NextResponse.json({ ok: false, error: sv.error.message }, { status: 400 }); }
      await audit(db, userId, 'wire_audit_run', 'bank_transaction', txId, { pass: rc.pass, blocks: rc.blocks, warns: rc.warns, ai_ok: ai.ok, fingerprint: hc });
      return NextResponse.json({ ok: true, pass: rc.pass, blocks: rc.blocks, warns: rc.warns, ai_ok: ai.ok });
    }

    // ── signoff: 1st, then 2nd by a DIFFERENT person — on the exact checked fingerprint
    if (action === 'signoff') {
      var g3 = await assertPermission(db, userId, 'wires.signoff', req);
      if (!g3.ok) { return NextResponse.json({ ok: false, error: 'Signing off needs "Wires: Sign Off" — Settings → Permissions.' }, { status: g3.status || 403 }); }
      var note = String(body.note || '').trim().substring(0, 1000);
      var Gs = await gather(db, [txId]);
      var inps = Gs.build(txId);
      var hs = wireFingerprint(inps.wire, inps.lines);
      var rs = await db.from('wire_audits').select('*').eq('bank_transaction_id', txId).maybeSingle();
      var a0 = rs && rs.data;
      if (!a0 || a0.check_hash !== hs) { return NextResponse.json({ ok: false, error: 'Run the 🤖 audit first — the bills on this wire changed (or were never checked).' }, { status: 409 }); }
      if (a0.check_pass !== true) { return NextResponse.json({ ok: false, error: 'The audit found blocking problems — fix them and re-run the audit before anyone can sign.' }, { status: 409 }); }
      if (a0.ai_ok !== true && note.length < 10) { return NextResponse.json({ ok: false, error: a0.ai_ok === false ? 'The AI review raised concerns — write what you verified about them (at least 10 characters) to sign.' : 'The AI review did not run — write what you verified (at least 10 characters) to sign.' }, { status: 400 }); }
      var s1ok = !!(a0.signoff1_by && a0.signoff1_hash === hs);
      var upd = {}; var slot = 1;
      if (!s1ok) {
        upd = { signoff1_by: userId, signoff1_at: new Date().toISOString(), signoff1_note: note || null, signoff1_hash: hs, signoff2_by: null, signoff2_at: null, signoff2_note: null, signoff2_hash: null };
      } else {
        if (a0.signoff2_by && a0.signoff2_hash === hs) { return NextResponse.json({ ok: false, error: 'This wire already has both sign-offs.' }, { status: 409 }); }
        if (a0.signoff1_by === userId) { return NextResponse.json({ ok: false, error: 'You signed first — the second sign-off must be a DIFFERENT person.' }, { status: 409 }); }
        slot = 2;
        upd = { signoff2_by: userId, signoff2_at: new Date().toISOString(), signoff2_note: note || null, signoff2_hash: hs };
      }
      upd.updated_at = new Date().toISOString();
      // only if nobody signed / re-ran the audit in between (two people clicking at once)
      var su = await db.from('wire_audits').update(upd).eq('id', a0.id).eq('updated_at', a0.updated_at).select('id');
      if (su.error) { return NextResponse.json({ ok: false, error: su.error.message + (/two_different/.test(su.error.message) ? ' — the same person cannot sign twice.' : '') }, { status: 400 }); }
      if (!su.data || !su.data.length) { return NextResponse.json({ ok: false, error: 'Someone signed or re-ran the audit at the same moment — reload the wire and check again.' }, { status: 409 }); }
      await audit(db, userId, slot === 1 ? 'wire_signoff_1' : 'wire_signoff_2', 'bank_transaction', txId, { fingerprint: hs, note: note || null });
      return NextResponse.json({ ok: true, slot: slot, approved: slot === 2 });
    }

    // ── set_release: fill the release number of a bill on a wire (Bills: Manage)
    if (action === 'set_release') {
      var g4 = await assertPermission(db, userId, 'bills.manage', req);
      if (!g4.ok) { return NextResponse.json({ ok: false, error: 'Changing a bill needs "Bills: Manage".' }, { status: g4.status || 403 }); }
      var billId = String(body.bill_id || '');
      var rel = normRef(body.release_number).substring(0, 40);
      if (!/^[0-9a-f-]{36}$/i.test(billId) || !rel) { return NextResponse.json({ ok: false, error: 'bill_id and release_number required.' }, { status: 400 }); }
      var ub = await db.from('vendor_bills').update({ release_number: rel, updated_at: new Date().toISOString() }).eq('id', billId).eq('record_status', 'active').select('id');
      if (ub.error) { return NextResponse.json({ ok: false, error: ub.error.message + (/release_number/.test(ub.error.message) ? ' — run sql/v55-83-RG-wires-recon.sql first.' : '') }, { status: 400 }); }
      if (!ub.data || !ub.data.length) { return NextResponse.json({ ok: false, error: 'Bill not found or void.' }, { status: 404 }); }
      await audit(db, userId, 'bill_release_set', 'vendor_bill', billId, { release_number: rel });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ ok: false, error: 'Unknown action "' + action + '".' }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e && e.message) || 'Server error' }, { status: 500 });
  }
}
