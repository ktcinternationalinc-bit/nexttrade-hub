// /api/accounting/party-funds — v55.83-WF step B. FUNDS WITH RTM / NEXTTRADE (Max, 20 Nov 2026).
//   funds        — per company: every transfer KTC sent it, with what it paid, explicit services-rendered fees, what is
//                  reserved for requests not sent yet, and what is still available. Read-only. The figures come from the ONE
//                  shared calculation (src/lib/party-funds.js) and — once the WF database step is installed — the database's own
//                  per-transfer state (confirmed / needs reconciliation, reserved, available).
//   confirm / unconfirm — say a transfer IS funds held by that company (spendable) or put it back to "needs reconciliation".
//   fee_mark / fee_reverse — mark part of a transfer's free money as "services rendered" (an internal expense) or undo one such
//                  fee. No payment is created either way. One click id = one result.
// Works with AND without sql/v55-83-WF-party-funds.sql: without it the list still shows (every transfer "needs reconciliation",
// nothing spendable) and the three write actions answer "needs one database update" and change nothing.
// Who: reading needs Accounting Access + Bills: View (amounts need "Bank & Financial Summary"); the write actions need the
// 🔒 "Advances: Manage" switch (only the super admin grants it — Max: "ONLY ME or permissioned"). A date inside a closed month
// is accepted only from the super admin. Every action is for the verified signed-in person. Private bank accounts are respected.
// Fails closed on any read error. SWC-safe: var + string concatenation only.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { assertPermission } from '../../../../lib/server-permissions';
import { verifiedCaller } from '../../../../lib/verified-caller';
import { US_WAVE_BUSINESS_ID } from '../../../../lib/business-of';
import { privateScope, isPrivateRow } from '../../../../lib/private-accounts-server';
import { loadPartyFunds } from '../../../../lib/party-funds-server';
import { feeExplanation, currentFundsWords, canSeeStartingBalance, HIDDEN_STARTING_BALANCE_REASON } from '../../../../lib/party-funds';
import { nextradeBillIds } from '../../../../lib/nextrade-bill-links-server'; // v55.83-XX — Nextrade bills are paid only through NextTrade

// v55.83-XO (Max 21-22 Nov) — STARTING BALANCES: money a company already held for KTC before the Hub ("a previous balance to
// nextrade that we will pay bills from"), and paying KTC bills from it ("b- NEW EXPENSE WHEN USED AFTER 6/1/2026").
//   opening_add            — add a starting balance (or a correction: a minus amount naming it). SUPER ADMIN only.
//   opening_pay_candidates — the bills that may be paid from it (read-only). SUPER ADMIN only.
//   opening_pay            — pay bills from it, dated 1 June 2026 or later. SUPER ADMIN only in this first version.
//   funds                  — now also lists each company's starting balances; one marked "staff may not see" is shown only to
//                            the super admin (for anyone else it is not listed and the company totals are withheld).
// Writes only through sql/v55-83-XO-starting-balance.sql (hub_party_opening_add / hub_party_opening_pay); without it they say
// which script to run and change nothing.
var API_BUILD_MARKER = 'v55.83-XO-party-funds';
var SQL_MISSING_XO = 'Starting balances need one database update first: run sql/v55-83-XO-starting-balance.sql (Supabase → SQL Editor → New query → paste → Run). Nothing was changed.';
var OPENING = { opening_add: 1, opening_pay: 1, opening_pay_candidates: 1 };
var OPENING_PAY_FROM = '2026-06-01'; // Max's (b): using a starting balance is a new expense from 1 June 2026
// (Codex 17:51 P2) NOT an instruction to install anything: the database step is released together with the screens that need it.
var SQL_MISSING_WF = 'Confirming a transfer and marking services rendered are not switched on yet — they arrive with a later update. Nothing was changed.';
var WRITES = { confirm: 1, unconfirm: 1, fee_mark: 1, fee_reverse: 1, refund: 1, record_paid: 1 };
// v55.83-XR (Max, 22 Nov 2026: "AS PER YOUR RECOMMENDATION" = Option 1) — Money back is ON. In the tax report the money that comes
// back reduces Professional fees in the month it arrives (the money-in line's bank date); it is never income (bills route
// period_stats). It still needs the WF database step (hub_party_refund, whole money-in line only), like every write here.
var REFUNDS_ON = true;
var REFUNDS_HELD = 'Money back is not switched on in this version. Nothing was changed.';

function admin() { return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } }); }
function r2(x) { return Math.round((Number(x) || 0) * 100) / 100; }
function fail(m, s) { return NextResponse.json({ ok: false, error: m }, { status: s || 400 }); }
function readFail(what, e) { return NextResponse.json({ ok: false, error: 'Could not read ' + what + ' (' + ((e && e.message) || 'error') + ') — nothing was changed.' }, { status: 503 }); }
// v55.83-XX (Max, 23 Nov: Nextrade bills "will be available for only Nextrade payments"; Codex 18:56: "NextTrade-only enforcement must also
// cover the selected funding company/opening") — a company that is not NextTrade (the affiliate) never pays a Nextrade bill: not from its
// starting balance, not as bills it already paid out of a transfer. Checked here, before the database step (whose own guards are unchanged).
// A failed lookup refuses (fails closed). Returns a refusal or null.
async function nextradeOnlyBlock(db, partyRow, billIds) {
  if (partyRow && partyRow.kind === 'affiliate') { return null; }
  var nb = await nextradeBillIds(db, billIds);
  if (!nb.ok) { return fail('Could not check whether these are Nextrade bills (' + (nb.error || 'read failed') + ') — nothing was recorded.', 503); }
  var hits = (billIds || []).filter(function (id) { return nb.ids[String(id)] === true; });
  if (!hits.length) { return null; }
  return fail((hits.length === 1 ? 'A bill you ticked is a Nextrade bill' : hits.length + ' bills you ticked are Nextrade bills') + ' — paid only through NextTrade (a wire to NextTrade Industries or the NextTrade starting balance), never through ' + ((partyRow && partyRow.name) || 'another company') + '. Untick ' + (hits.length === 1 ? 'it' : 'them') + '. Nothing was recorded.', 409);
}
// the same rule for the read-only pick lists: a company that is not NextTrade does not list Nextrade bills (lookup failed → listed; the write refuses)
async function dropNextradeBills(db, partyRow, bills) {
  if ((partyRow && partyRow.kind === 'affiliate') || !(bills || []).length) { return bills; }
  var nb = await nextradeBillIds(db, bills.map(function (b) { return b.id; }));
  if (!nb.ok) { return bills; }
  return bills.filter(function (b) { return nb.ids[String(b.id)] !== true; });
}
function isDate(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s); }
// (Codex 17:51 P1) a person who may act but may NOT see balances ("Bank & Financial Summary") never gets a figure back from a
// write: not in the answer (it is a bare acknowledgment — the screen reloads the permission-filtered list) and not inside a
// refusal either (the database's message names what the transfer holds; every amount in it is blanked for that person).
function guardFail(rpc, canTotals) {
  var m = String((rpc.error && rpc.error.message) || '');
  if (/HUB_GUARD:/.test(m)) {
    var words = m.replace(/^[\s\S]*HUB_GUARD:\s*/, '');
    if (!canTotals) { words = words.replace(/\$\s?[0-9][0-9,]*(\.[0-9]+)?/g, 'an amount').replace(/\(to bills[^)]*\)\.?/i, '').replace(/\s{2,}/g, ' ').trim(); }
    return fail('Not done — ' + words + ' Nothing was changed.', 409);
  }
  return fail('Not done (' + (canTotals ? (m || 'database error') : 'database error') + '). Nothing was changed.', 500);
}
// what a write answers: that it happened, and nothing about money
function ack(action, data) { var d = data || {}; var o = { ok: true, action: action }; if (d.to) { o.status = d.to; } if (d.entry_id) { o.entry_id = d.entry_id; } if (d.repeat === true) { o.repeat = true; } return o; }
async function fetchAllRows(build) {
  var out = [];
  for (var pg = 0; pg < 40; pg++) {
    var r = await build().range(pg * 1000, pg * 1000 + 999);
    if (r.error) { throw new Error(r.error.message || 'read error'); }
    out = out.concat(r.data || []);
    if (!r.data || r.data.length < 1000) { break; }
  }
  return out;
}

export async function POST(req) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) { return fail('Server key missing.', 500); }
  var db = admin();
  try {
    var body = await req.json();
    var action = String(body.action || '');
    if (action !== 'funds' && action !== 'refund_candidates' && action !== 'record_paid_candidates' && !WRITES[action] && !OPENING[action]) { return fail('Unknown action.'); }
    var who = await verifiedCaller(req, body, createClient);
    if (who.error) { return fail(who.error, who.status || 401); }
    var userId = who.userId;
    var gA = await assertPermission(db, userId, 'accounting.view', req);
    if (!gA || gA.ok !== true) { return fail('This needs "Accounting Access" (P1).', 403); }
    var isSuper = !!(gA.ctx && gA.ctx.isSuperAdmin);
    if (OPENING[action] && !isSuper) { return fail('Starting balances are added and used by the super admin only.', 403); } // v55.83-XO
    var gM = await assertPermission(db, userId, 'advances.manage', req);
    var canManage = !!(gM && gM.ok === true);
    if (WRITES[action] && !canManage) { return fail('Confirming a transfer and marking services rendered need the 🔒 "Advances: Manage" permission — only the super admin can grant it.', 403); }
    if (!canManage) {
      var gV = await assertPermission(db, userId, 'bills.view', req); if (!gV || gV.ok !== true) { gV = await assertPermission(db, userId, 'bills.manage', req); }
      if (!gV || gV.ok !== true) { return fail('This needs the "Bills: View" permission.', 403); }
    }
    var scope = await privateScope(db, userId);
    if (scope.error) { return fail(scope.error + (WRITES[action] ? ' — nothing was changed.' : ' — nothing shown.'), 503); }
    var pr = await db.from('paid_through_parties').select('name, kind');
    if (pr.error) { return readFail('the companies', pr.error); }
    var parties = pr.data || [];
    var instR = await db.rpc('hub_party_funds_installed');
    var installed = !instR.error && instR.data === true;
    var xoR = await db.rpc('hub_party_opening_installed'); // v55.83-XO
    var installedXO = !xoR.error && xoR.data === true;

    // ── v55.83-XO — STARTING BALANCES (super admin only; checked above). Only through the XO database functions. ──
    if (OPENING[action]) {
      if (!installedXO) { return fail(SQL_MISSING_XO, 409); }
      var obParty = parties.filter(function (p) { return p.name === body.party; })[0];
      if (!obParty) { return fail('Pick NextTrade or RTM.'); }
      if (action === 'opening_pay_candidates') {
        // the bills that may be paid from a starting balance: KTC's, active, in US dollars, open (not paid, not on an open wire),
        // paid through this company or by nobody yet. Read-only.
        var ocq; try { ocq = await fetchAllRows(function () { return db.from('vendor_bills').select('id, vendor_name, bill_number, bill_date, total_amount, paid_via, record_status, currency').eq('wave_business_id', US_WAVE_BUSINESS_ID).eq('record_status', 'active').order('id', { ascending: true }); }); } catch (eOc) { return readFail('the bills', eOc); }
        var ocb = ocq.filter(function (b) { return (!b.paid_via || String(b.paid_via).toLowerCase() === obParty.name.toLowerCase()) && String(b.currency || 'USD').toUpperCase() === 'USD'; });
        var ocIds = ocb.map(function (b) { return b.id; }); var ocPaid = {}; var ocWire = {};
        for (var oi = 0; oi < ocIds.length; oi += 200) {
          var opq = await db.from('vendor_bill_payments').select('bill_id, amount, voided').in('bill_id', ocIds.slice(oi, oi + 200));
          if (opq.error) { return readFail('what is paid on the bills', opq.error); }
          (opq.data || []).forEach(function (x) { if (x.voided !== true) { ocPaid[x.bill_id] = r2((ocPaid[x.bill_id] || 0) + (Number(x.amount) || 0)); } });
          var owq = await db.from('wire_package_lines').select('bill_id, amount, is_open').in('bill_id', ocIds.slice(oi, oi + 200));
          if (owq.error) { return readFail('the wires the bills are on', owq.error); }
          (owq.data || []).forEach(function (x) { if (x.is_open === true) { ocWire[x.bill_id] = r2((ocWire[x.bill_id] || 0) + (Number(x.amount) || 0)); } });
        }
        var ocOut = ocb.map(function (b) { return { id: b.id, vendor: b.vendor_name || '', bill_number: b.bill_number || '', bill_date: b.bill_date || null, total: r2(b.total_amount), open: r2((Number(b.total_amount) || 0) - (ocPaid[b.id] || 0) - (ocWire[b.id] || 0)), via: b.paid_via || null }; })
          .filter(function (b) { return b.open > 0.005; }).sort(function (a, b) { return String(a.bill_date || '') < String(b.bill_date || '') ? -1 : 1; });
        ocOut = await dropNextradeBills(db, obParty, ocOut); // v55.83-XX
        return NextResponse.json({ ok: true, bills: ocOut.slice(0, 500) });
      }
      var obRid = typeof body.request_id === 'string' && body.request_id.trim().length >= 8 ? body.request_id.trim().substring(0, 80) : null;
      if (!obRid) { return fail('Refresh the page and try again (missing click id).'); }
      if (action === 'opening_add') {
        var obAmt = r2(body.amount); if (!obAmt) { return fail('Type the amount.'); }
        var obWhy = String(body.reason || '').trim().substring(0, 500); if (obWhy.length < 10) { return fail('Say where this number comes from (at least 10 characters).'); }
        var obP = { party: obParty.name, amount: obAmt, reason: obWhy, actor: userId, request_id: obRid };
        if (obAmt > 0) {
          if (!isDate(body.as_of)) { return fail('Pick the date this balance is as of.'); }
          if (body.visible_to_staff !== true && body.visible_to_staff !== false) { return fail('Say whether staff may see this balance.'); }
          if (body.corrects_id) { return fail('Only a minus amount corrects a starting balance.'); }
          obP.as_of = body.as_of; obP.visible_to_staff = body.visible_to_staff;
        } else {
          if (!body.corrects_id) { return fail('A minus amount is a correction — pick the starting balance it corrects.'); }
          obP.corrects_id = String(body.corrects_id);
        }
        var oa = await db.rpc('hub_party_opening_add', { p: obP });
        if (oa.error) { return guardFail(oa, true); }
        var oaAck = { ok: true, action: action, id: (oa.data && oa.data.id) || null }; if (oa.data && oa.data.repeat === true) { oaAck.repeat = true; }
        return NextResponse.json(oaAck);
      }
      // opening_pay
      if (!body.opening_id) { return fail('Pick the starting balance.'); }
      var opBills = Array.isArray(body.bills) ? body.bills : [];
      if (!opBills.length || opBills.length > 50) { return fail('Pick the bills (1 to 50).'); }
      var opClean = []; for (var ob = 0; ob < opBills.length; ob++) { var ox = opBills[ob] || {}; var oam = r2(ox.amount); if (!ox.bill_id || !(oam > 0)) { return fail('Every bill needs an amount above zero.'); } opClean.push({ bill_id: String(ox.bill_id), amount: oam }); }
      if (!isDate(body.paid_date)) { return fail('Pick the date these bills are paid.'); }
      if (body.paid_date < OPENING_PAY_FROM) { return fail('Bills are paid from a starting balance on 1 June 2026 or later (using it is a new expense from that date). Nothing was recorded.', 409); }
      var opRef = String(body.reference || '').trim().substring(0, 200); if (opRef.length < 3) { return fail('Type the payment reference or where the proof is.'); }
      var opWhy = String(body.reason || '').trim().substring(0, 300); if (opWhy.length < 3) { return fail('Say why, in a few words.'); }
      var ntOp = await nextradeOnlyBlock(db, obParty, opClean.map(function (x) { return x.bill_id; })); if (ntOp) { return ntOp; } // v55.83-XX
      var opR = await db.rpc('hub_party_opening_pay', { p: { party: obParty.name, opening_id: String(body.opening_id), bills: opClean, paid_date: body.paid_date, reference: opRef, reason: opWhy, actor: userId, request_id: obRid, allow_closed: isSuper && body.allow_closed === true } });
      if (opR.error) { return guardFail(opR, true); }
      var opAck = { ok: true, action: action, bills: opClean.length }; if (opR.data && opR.data.repeat === true) { opAck.repeat = true; }
      return NextResponse.json(opAck);
    }

    // v55.83-WF B2 — the money-in lines a refund of this transfer could have arrived on (for the person who records it). Read-only.
    // KTC's books, settled, not a duplicate, not paired between own accounts, not matched to an invoice, not already a refund;
    // from the transfer's date on. Each line's own amount is shown (no totals). Private lines only for people who may see them.
    if ((action === 'refund_candidates' || action === 'refund') && !REFUNDS_ON) { return fail(REFUNDS_HELD, 409); }
    if (action === 'refund_candidates' && !installed) { return fail(SQL_MISSING_WF, 409); } // v55.83-XR — Money back needs the WF database step, like every write
    // v55.83-WF (Codex 21 Nov 09:05) — the bills a person may record as ALREADY paid by the company out of a transfer (history,
    // before the transfer is confirmed): active, still open, not on an open wire, paid through this company or by nobody yet. Read-only.
    if (action === 'record_paid_candidates') {
      if (!canManage) { return fail('This needs the 🔒 "Advances: Manage" permission.', 403); }
      var pcParty = parties.filter(function (p) { return p.name === body.party; })[0]; if (!pcParty) { return fail('Pick NextTrade or RTM.'); }
      // Codex 09:27 — no currency conversion: only bills in the transfer's own currency can be recorded against it
      var pcT = await db.from('bank_transactions').select('id, iso_currency, wave_business_id, account_id').eq('id', body.bank_transaction_id || '').maybeSingle();
      if (pcT.error) { return readFail('the transfer', pcT.error); }
      if (!pcT.data || pcT.data.wave_business_id !== US_WAVE_BUSINESS_ID || isPrivateRow(pcT.data, scope) || (!scope.all && !pcT.data.account_id)) { return fail('Transfer not found.', 404); }
      var pcCur = String(pcT.data.iso_currency || 'USD').toUpperCase();
      var vbq; try { vbq = await fetchAllRows(function () { return db.from('vendor_bills').select('id, vendor_name, bill_number, bill_date, total_amount, paid_via, record_status, currency').eq('wave_business_id', US_WAVE_BUSINESS_ID).eq('record_status', 'active').order('id', { ascending: true }); }); } catch (eVb) { return readFail('the bills', eVb); }
      var vbs = vbq.filter(function (b) { return !b.paid_via || String(b.paid_via).toLowerCase() === pcParty.name.toLowerCase(); });
      vbs = await dropNextradeBills(db, pcParty, vbs); // v55.83-XX — a Nextrade bill is never listed for RTM
      var vIds = vbs.map(function (b) { return b.id; }); var paidB = {}; var onWire = {};
      for (var vi = 0; vi < vIds.length; vi += 200) {
        var ppq = await db.from('vendor_bill_payments').select('bill_id, amount, voided').in('bill_id', vIds.slice(vi, vi + 200));
        if (ppq.error) { return readFail('what is paid on the bills', ppq.error); }
        (ppq.data || []).forEach(function (x) { if (x.voided !== true) { paidB[x.bill_id] = r2((paidB[x.bill_id] || 0) + (Number(x.amount) || 0)); } });
        var wlq = await db.from('wire_package_lines').select('bill_id, amount, is_open').in('bill_id', vIds.slice(vi, vi + 200));
        if (wlq.error) { return readFail('the wires the bills are on', wlq.error); }
        (wlq.data || []).forEach(function (x) { if (x.is_open === true) { onWire[x.bill_id] = r2((onWire[x.bill_id] || 0) + (Number(x.amount) || 0)); } });
      }
      var cb = vbs.map(function (b) { return { id: b.id, vendor: b.vendor_name || '', bill_number: b.bill_number || '', bill_date: b.bill_date || null, total: r2(b.total_amount), currency: String(b.currency || 'USD').toUpperCase(), open: r2((Number(b.total_amount) || 0) - (paidB[b.id] || 0) - (onWire[b.id] || 0)), via: b.paid_via || null }; })
        .filter(function (b) { return b.open > 0.005; }).sort(function (a, b) { return String(a.bill_date || '') < String(b.bill_date || '') ? -1 : 1; });
      cb.forEach(function (b) { b.same_currency = b.currency === pcCur; });
      return NextResponse.json({ ok: true, transfer_currency: pcCur, bills: cb.slice(0, 500) });
    }
    if (action === 'refund_candidates') {
      if (!canManage) { return fail('This needs the 🔒 "Advances: Manage" permission.', 403); }
      var tq = await db.from('bank_transactions').select('id, date, posted_date, wave_business_id, account_id, third_party_payer').eq('id', body.bank_transaction_id || '').maybeSingle();
      if (tq.error) { return readFail('the transfer', tq.error); }
      if (!tq.data || tq.data.wave_business_id !== US_WAVE_BUSINESS_ID || isPrivateRow(tq.data, scope) || (!scope.all && !tq.data.account_id)) { return fail('Transfer not found.', 404); }
      var since = String(tq.data.posted_date || tq.data.date || '').substring(0, 10);
      var cq = await db.from('bank_transactions').select('id, date, posted_date, amount_abs, name, merchant_name, account_id, transfer_group_id, review_status, pending').eq('wave_business_id', US_WAVE_BUSINESS_ID).eq('direction', 'in').neq('pending', true).neq('review_status', 'duplicate').is('matched_invoice_id', null).gte('date', since).order('date', { ascending: true }).limit(400);
      if (cq.error) { return readFail('the money-in lines', cq.error); }
      var cands = (cq.data || []).filter(function (x) { return !x.transfer_group_id && !isPrivateRow(x, scope) && (scope.all || !!x.account_id); });
      var cIds = cands.map(function (x) { return x.id; }); var taken = {};
      for (var ci = 0; ci < cIds.length; ci += 200) {
        var eq2 = await db.from('party_money_entries').select('bank_transaction_id').eq('kind', 'refund').in('bank_transaction_id', cIds.slice(ci, ci + 200));
        if (eq2.error && !/does not exist|schema cache|refund/i.test(String(eq2.error.message || ''))) { return readFail('the refunds already recorded', eq2.error); }
        ((eq2 && eq2.data) || []).forEach(function (x) { taken[x.bank_transaction_id] = true; });
        var ip = await db.from('accounting_invoice_payments').select('bank_transaction_id, voided').in('bank_transaction_id', cIds.slice(ci, ci + 200));
        if (ip.error) { return readFail('the customer payments', ip.error); }
        (ip.data || []).forEach(function (x) { if (x.voided !== true) { taken[x.bank_transaction_id] = true; } });
      }
      return NextResponse.json({ ok: true, lines: cands.filter(function (x) { return !taken[x.id]; }).slice(0, 60).map(function (x) { return { id: x.id, date: String(x.posted_date || x.date || '').substring(0, 10), who: x.merchant_name || x.name || '', amount: r2(x.amount_abs) }; }) });
    }
    if (action === 'funds') {
      var gT = await assertPermission(db, userId, 'accounting.view_totals', req);
      var canTotals = !!(gT && gT.ok === true);
      var from = isDate(body.from) ? body.from : null; var to = isDate(body.to) ? body.to : null;
      var loaded;
      try {
        var billsArr = await fetchAllRows(function () { return db.from('vendor_bills').select('id, vendor_name, bill_number, bill_date, category, total_amount, paid_via, record_status, release_number').eq('wave_business_id', US_WAVE_BUSINESS_ID).not('paid_via', 'is', null).order('id', { ascending: true }); });
        var billById = {}; billsArr.forEach(function (b) { billById[b.id] = b; });
        var entries = await fetchAllRows(function () { return db.from('party_money_entries').select('*').order('id', { ascending: true }); });
        // every live bill payment that sits on a bank line or belongs to a bill paid through a company (the helper sorts them)
        var pays = await fetchAllRows(function () { return db.from('vendor_bill_payments').select('id, bill_id, amount, paid_date, bank_transaction_id, voided, method').neq('voided', true).order('id', { ascending: true }); });
        var missing = {}; pays.forEach(function (p) { if (p.bank_transaction_id && !billById[p.bill_id]) { missing[p.bill_id] = true; } });
        var mIds = Object.keys(missing);
        for (var mi = 0; mi < mIds.length; mi += 200) {
          var mb = await db.from('vendor_bills').select('id, vendor_name, bill_number, bill_date, category, total_amount, paid_via, record_status, release_number').in('id', mIds.slice(mi, mi + 200));
          if (mb.error) { throw new Error(mb.error.message); }
          (mb.data || []).forEach(function (b) { billById[b.id] = b; });
        }
        loaded = await loadPartyFunds(db, { fetchAll: fetchAllRows, businessId: US_WAVE_BUSINESS_ID, parties: parties, pays: pays, bills: billById, entries: entries, from: from, to: to });
      } catch (eR) { if (eR && eR.code === 'XO_UNAVAILABLE') { return NextResponse.json({ ok: false, unavailable: 'starting_balances', error: 'Could not read ' + eR.message + '. Nothing is shown, so no total is given without them. Try again in a moment.' }, { status: 503 }); } return readFail('the funds held', eR); } // v55.83-XO (Codex 14:52 P2)
      // which bank account each transfer is in (privacy), and the database's own state per transfer when WF is installed
      var ids = loaded.lines.map(function (l) { return l.id; }); var acct = {};
      for (var ai = 0; ai < ids.length; ai += 200) {
        var aq = await db.from('bank_transactions').select('id, account_id').in('id', ids.slice(ai, ai + 200));
        if (aq.error) { return readFail('the transfers', aq.error); }
        (aq.data || []).forEach(function (x) { acct[x.id] = x.account_id; });
      }
      var out = [];
      for (var pi = 0; pi < loaded.funds.length; pi++) {
        var f = loaded.funds[pi]; var hiddenN = 0; var rows = [];
        for (var ti = 0; ti < f.transfers.length; ti++) {
          var t = f.transfers[ti];
          if (isPrivateRow({ account_id: acct[t.id] }, scope) || (!scope.all && !acct[t.id])) { hiddenN++; continue; } // unknown account = hidden for a restricted person
          var dbs = null;
          if (installed && t.identity === 'marked') { var sq = await db.rpc('hub_party_transfer_state', { p_txn: t.id, p_except: null }); if (sq.error) { return readFail('a transfer’s state', sq.error); } dbs = sq.data || null; }
          var status = t.identity !== 'marked' ? 'to_confirm_identity' : (dbs && dbs.status) || 'needs_reconciliation';
          var row = { id: t.id, date: t.date, reference: t.reference, identity: t.identity, status: status,
            bills: t.lifetime_rows.map(function (r) { return { bill_id: r.bill_id, vendor: r.vendor, bill_number: r.bill_number, paid_date: r.paid_date, release_number: r.release_number, portion: canTotals ? r.portion : null, bill_total: canTotals ? r.bill_total : null, category: r.source_bill.category }; }),
            fees: t.lifetime_fee_rows.map(function (r) { return { id: r.id, date: r.date, why: r.why, amount: canTotals ? r.amount : null }; }),
            reserved_for: t.reserved_rows.map(function (r) { return { request_id: r.request_id, status: r.status, amount: canTotals ? r.amount : null }; }),
            refunds: (t.lifetime_refund_rows || []).map(function (r) { return { id: r.id, date: r.date, why: r.why, amount: canTotals ? r.amount : null }; }) };
          if (canTotals) {
            row.sent = t.sent; row.to_bills = t.current.applied_to_bills; row.services_rendered = t.current.services_rendered; row.reserved = t.current.reserved; row.refunded = t.current.refunds || 0; row.held = r2(t.sent - row.refunded - t.current.applied_to_bills - t.current.services_rendered);
            // spendable only when the database says the transfer is confirmed; the database's number wins when it is there
            row.available = status === 'confirmed' ? (dbs ? r2(dbs.available) : r2(t.current.unused)) : 0;
            row.database_agrees = dbs ? Math.abs(r2(dbs.held) - row.held) < 0.005 && Math.abs(r2(dbs.reserved) - row.reserved) < 0.005 : null;
          }
          rows.push(row);
        }
        // v55.83-XO — the starting balances. One marked "staff may not see" is listed only for the super admin; for anyone else it
        // is left out and the company totals are withheld (they would include it). Amounts need "Bank & Financial Summary".
        var sbRows = []; var hiddenSb = 0;
        (f.starting_balances || []).forEach(function (s) {
          if (!canSeeStartingBalance(s, isSuper)) { hiddenSb++; return; } // the ONE rule (party-funds.js), also used by the report route
          var sr = { id: s.id, kind: 'starting_balance', as_of: s.as_of, reason: s.reason, visible_to_staff: s.visible_to_staff, corrections_count: (s.correction_rows || []).length,
            bills: s.lifetime_rows.map(function (r) { return { bill_id: r.bill_id, vendor: r.vendor, bill_number: r.bill_number, paid_date: r.paid_date, release_number: r.release_number, portion: canTotals ? r.portion : null, category: r.source_bill.category }; }) };
          if (canTotals) { sr.amount = s.amount; sr.original = s.original; sr.corrections = s.corrections; sr.used = s.current.used; sr.left = s.current.held; }
          sbRows.push(sr);
        });
        var o = { party: f.party, transfers: rows, hidden_private_transfers: hiddenN, needs_reconciliation: hiddenSb ? (f.transfers_need_reconciliation === true || (f.starting_balances || []).some(function (s) { return canSeeStartingBalance(s, isSuper) && s.over_used === true; })) : f.needs_reconciliation, // v55.83-XO (Codex 18:29): never says a hidden balance is over-used
          identity_to_confirm_count: f.identity_to_confirm.count,
          paid_without_a_transfer_count: f.paid_without_a_transfer.lifetime_rows.length, starting_balances: sbRows, hidden_starting_balances: hiddenSb };
        if (canTotals && hiddenN === 0 && hiddenSb === 0) {
          var spend = 0; var heldAll = 0; var unconf = 0; rows.forEach(function (r) { spend = r2(spend + r.available); heldAll = r2(heldAll + r.held); if (r.status !== 'confirmed') { unconf = r2(unconf + r.held - r.reserved); } });
          o.totals = { funds_sent: f.current.funds_sent, refunded: f.current.refunds || 0, to_bills: f.current.applied_to_bills, services_rendered: f.current.services_rendered, reserved: f.current.reserved, held: heldAll, available: spend, not_confirmed: unconf,
            paid_without_a_transfer: f.paid_without_a_transfer.lifetime_total, identity_to_confirm: f.identity_to_confirm.sent,
            starting_balance: f.current.starting_balance || 0, starting_balance_used: f.current.from_starting_balance || 0, starting_balance_left: f.current.starting_balance_held || 0 }; // v55.83-XO (held / available above stay the transfers')
          o.words = currentFundsWords(f);
          if (from || to) { o.period = { from: from, to: to, opening_held: f.period.opening_held, funds_sent: f.period.funds_sent, refunds: f.period.refunds || 0, applied_to_bills: f.period.applied_to_bills, services_rendered: f.period.services_rendered, closing_held: f.period.closing_held, fee_deduction: f.period.fee_deduction, tax_professional_fees: f.period.tax_professional_fees,
            starting_balance_added: f.period.starting_balance_added || 0, from_starting_balance: f.period.from_starting_balance || 0, tax_from_starting_balance: f.period.tax_from_starting_balance || 0, words: feeExplanation(f) }; }
        } else { o.totals = null; o.totals_hidden = !canTotals ? 'needs the Bank & Financial Summary permission' : hiddenN > 0 ? 'includes a transfer from a private account' : HIDDEN_STARTING_BALANCE_REASON; }
        out.push(o);
      }
      return NextResponse.json({ ok: true, parties: out, installed: installed, sql_missing: installed ? null : SQL_MISSING_WF, can_manage: canManage, can_closed_month: isSuper, can_totals: canTotals,
        starting_balances_installed: installedXO, can_starting_balance: isSuper, starting_balance_sql_missing: isSuper && !installedXO ? SQL_MISSING_XO : null, starting_balance_pay_from: OPENING_PAY_FROM, api_build_marker: API_BUILD_MARKER });
    }

    // ── the three write actions: only through the database functions (locks, never below zero, one click = one result) ──
    if (!installed) { return fail(SQL_MISSING_WF, 409); }
    var party = parties.filter(function (p) { return p.name === body.party; })[0];
    if (!party) { return fail('Pick NextTrade or RTM.'); }
    var lq = await db.from('bank_transactions').select('id, wave_business_id, direction, account_id, third_party_payer').eq('id', body.bank_transaction_id || '').maybeSingle();
    if (lq.error) { return readFail('the transfer', lq.error); }
    var line = lq.data;
    if (!line || isPrivateRow(line, scope) || (!scope.all && !line.account_id)) { return fail('Transfer not found.', 404); }
    if (line.wave_business_id !== US_WAVE_BUSINESS_ID) { return fail('That bank line is not in KTC’s books.', 409); }

    var gTW = await assertPermission(db, userId, 'accounting.view_totals', req);
    var canTotalsW = !!(gTW && gTW.ok === true);
    if (action === 'confirm' || action === 'unconfirm') {
      var rs = await db.rpc('hub_party_transfer_set_state', { p: { bank_transaction_id: line.id, party: party.name, state: action === 'confirm' ? 'confirmed' : 'needs_reconciliation', note: String(body.note || '').trim().substring(0, 300) || null, actor: userId } });
      if (rs.error) { return guardFail(rs, canTotalsW); }
      return NextResponse.json(ack(action, rs.data));
    }
    var rid = typeof body.request_id === 'string' && body.request_id.trim().length >= 8 ? body.request_id.trim().substring(0, 80) : null;
    if (!rid) { return fail('Refresh the page and try again (missing click id).'); }
    // v55.83-WF (Codex 21 Nov 09:05) — RECORD BILLS ALREADY PAID by the company out of this transfer: history, not a new payment,
    // before the transfer is confirmed. The real date the company paid (never our transfer date), a reference / where the proof is,
    // the person's statement that they were already paid, a reason. Database: hub_party_record_paid (locks, caps, audit).
    if (action === 'record_paid') {
      var rpBills = Array.isArray(body.bills) ? body.bills : [];
      if (!rpBills.length || rpBills.length > 50) { return fail('Pick the bills (1 to 50).'); }
      var rpClean = []; for (var bi = 0; bi < rpBills.length; bi++) { var bx = rpBills[bi] || {}; var ba = r2(bx.amount); if (!bx.bill_id || !(ba > 0)) { return fail('Every bill needs an amount above zero.'); } rpClean.push({ bill_id: String(bx.bill_id), amount: ba }); }
      if (!isDate(body.paid_date)) { return fail('Type the date ' + party.name + ' actually paid these bills.'); }
      var rpRef = String(body.reference || '').trim().substring(0, 200); if (rpRef.length < 3) { return fail('Type the payment reference or where the proof is.'); }
      if (body.already_paid !== true) { return fail('Tick that these bills were ALREADY paid by ' + party.name + ' out of this transfer. New bills go through Wires → New.'); }
      var rpWhy = String(body.reason || '').trim().substring(0, 300); if (rpWhy.length < 3) { return fail('Say why, in a few words.'); }
      // Codex 09:27 — a bill in another currency than the transfer is refused (no conversion is made); the database checks it again
      var rpT = await db.from('bank_transactions').select('iso_currency').eq('id', line.id).maybeSingle(); if (rpT.error) { return readFail('the transfer', rpT.error); }
      var rpCur = String((rpT.data && rpT.data.iso_currency) || 'USD').toUpperCase();
      var rpB = await db.from('vendor_bills').select('id, vendor_name, bill_number, currency').in('id', rpClean.map(function (x) { return x.bill_id; })); if (rpB.error) { return readFail('the bills', rpB.error); }
      var rpOff = (rpB.data || []).filter(function (b) { return String(b.currency || 'USD').toUpperCase() !== rpCur; });
      if (rpOff.length) { return fail(rpOff.map(function (b) { return (b.vendor_name || 'A bill') + ' ' + (b.bill_number || '') + ' is in ' + String(b.currency).toUpperCase(); }).join('; ') + ' — the transfer is in ' + rpCur + '. A bill in another currency cannot be recorded against it (no conversion is made). Nothing was recorded.', 409); }
      var ntRp = await nextradeOnlyBlock(db, party, rpClean.map(function (x) { return x.bill_id; })); if (ntRp) { return ntRp; } // v55.83-XX
      var rpR = await db.rpc('hub_party_record_paid', { p: { party: party.name, bank_transaction_id: line.id, bills: rpClean, paid_date: body.paid_date, reference: rpRef, already_paid: true, reason: rpWhy, actor: userId, request_id: rid, allow_closed: isSuper && body.allow_closed === true } });
      if (rpR.error) { return guardFail(rpR, canTotalsW); }
      var rpA = ack(action, rpR.data); rpA.bills = rpClean.length; return NextResponse.json(rpA);
    }
    var amount = r2(body.amount);
    if (!(amount > 0)) { return fail('Type an amount above zero.'); }
    var reason = String(body.reason || '').trim().substring(0, 300);
    if (reason.length < 3) { return fail('Say why, in a few words.'); }
    if (body.entry_date && !isDate(body.entry_date)) { return fail('Pick the date.'); }
    if (action === 'fee_reverse' && !body.fee_id) { return fail('Pick the fee to reverse.'); }
    if (action === 'refund') {
      // v55.83-WF B2 — money back from the company, against ITS transfer, on the money-in line it arrived on (database: hub_party_refund)
      var inq = await db.from('bank_transactions').select('id, wave_business_id, direction, account_id').eq('id', body.incoming_bank_transaction_id || '').maybeSingle();
      if (inq.error) { return readFail('the money-in line', inq.error); }
      if (!inq.data || isPrivateRow(inq.data, scope) || (!scope.all && !inq.data.account_id)) { return fail('Money-in line not found.', 404); }
      var rr = await db.rpc('hub_party_refund', { p: { party: party.name, bank_transaction_id: line.id, incoming_bank_transaction_id: inq.data.id, amount: amount, entry_date: body.entry_date || null, reason: reason, actor: userId, request_id: rid, allow_closed: isSuper && body.allow_closed === true } });
      if (rr.error) { return guardFail(rr, canTotalsW); }
      return NextResponse.json(ack(action, rr.data));
    }
    var rf = await db.rpc('hub_party_fee', { p: { action: action === 'fee_mark' ? 'mark' : 'reverse', party: party.name, bank_transaction_id: line.id, amount: amount, entry_date: body.entry_date || null, reason: reason,
      fee_id: action === 'fee_reverse' ? String(body.fee_id).replace(/^entry:/, '') : null, actor: userId, request_id: rid, allow_closed: isSuper && body.allow_closed === true } });
    if (rf.error && rf.error.code === '23505') { rf = await db.rpc('hub_party_fee', { p: { action: action === 'fee_mark' ? 'mark' : 'reverse', party: party.name, bank_transaction_id: line.id, amount: amount, entry_date: body.entry_date || null, reason: reason,
      fee_id: action === 'fee_reverse' ? String(body.fee_id).replace(/^entry:/, '') : null, actor: userId, request_id: rid, allow_closed: isSuper && body.allow_closed === true } }); }
    if (rf.error) { return guardFail(rf, canTotalsW); }
    return NextResponse.json(ack(action, rf.data));
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e && e.message) || 'error', api_build_marker: API_BUILD_MARKER }, { status: 500 });
  }
}
