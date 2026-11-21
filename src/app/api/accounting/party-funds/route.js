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
import { feeExplanation, currentFundsWords } from '../../../../lib/party-funds';

var API_BUILD_MARKER = 'v55.83-WF-party-funds';
// (Codex 17:51 P2) NOT an instruction to install anything: the database step is released together with the screens that need it.
var SQL_MISSING_WF = 'Confirming a transfer and marking services rendered are not switched on yet — they arrive with a later update. Nothing was changed.';
var WRITES = { confirm: 1, unconfirm: 1, fee_mark: 1, fee_reverse: 1, refund: 1 };

function admin() { return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } }); }
function r2(x) { return Math.round((Number(x) || 0) * 100) / 100; }
function fail(m, s) { return NextResponse.json({ ok: false, error: m }, { status: s || 400 }); }
function readFail(what, e) { return NextResponse.json({ ok: false, error: 'Could not read ' + what + ' (' + ((e && e.message) || 'error') + ') — nothing was changed.' }, { status: 503 }); }
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
    if (action !== 'funds' && action !== 'refund_candidates' && !WRITES[action]) { return fail('Unknown action.'); }
    var who = await verifiedCaller(req, body, createClient);
    if (who.error) { return fail(who.error, who.status || 401); }
    var userId = who.userId;
    var gA = await assertPermission(db, userId, 'accounting.view', req);
    if (!gA || gA.ok !== true) { return fail('This needs "Accounting Access" (P1).', 403); }
    var isSuper = !!(gA.ctx && gA.ctx.isSuperAdmin);
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

    // v55.83-WF B2 — the money-in lines a refund of this transfer could have arrived on (for the person who records it). Read-only.
    // KTC's books, settled, not a duplicate, not paired between own accounts, not matched to an invoice, not already a refund;
    // from the transfer's date on. Each line's own amount is shown (no totals). Private lines only for people who may see them.
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
      } catch (eR) { return readFail('the funds held', eR); }
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
        var o = { party: f.party, transfers: rows, hidden_private_transfers: hiddenN, needs_reconciliation: f.needs_reconciliation, identity_to_confirm_count: f.identity_to_confirm.count,
          paid_without_a_transfer_count: f.paid_without_a_transfer.lifetime_rows.length };
        if (canTotals && hiddenN === 0) {
          var spend = 0; var heldAll = 0; var unconf = 0; rows.forEach(function (r) { spend = r2(spend + r.available); heldAll = r2(heldAll + r.held); if (r.status !== 'confirmed') { unconf = r2(unconf + r.held - r.reserved); } });
          o.totals = { funds_sent: f.current.funds_sent, refunded: f.current.refunds || 0, to_bills: f.current.applied_to_bills, services_rendered: f.current.services_rendered, reserved: f.current.reserved, held: heldAll, available: spend, not_confirmed: unconf,
            paid_without_a_transfer: f.paid_without_a_transfer.lifetime_total, identity_to_confirm: f.identity_to_confirm.sent };
          o.words = currentFundsWords(f);
          if (from || to) { o.period = { from: from, to: to, opening_held: f.period.opening_held, funds_sent: f.period.funds_sent, refunds: f.period.refunds || 0, applied_to_bills: f.period.applied_to_bills, services_rendered: f.period.services_rendered, closing_held: f.period.closing_held, fee_deduction: f.period.fee_deduction, tax_professional_fees: f.period.tax_professional_fees, words: feeExplanation(f) }; }
        } else { o.totals = null; o.totals_hidden = canTotals ? 'includes a transfer from a private account' : 'needs the Bank & Financial Summary permission'; }
        out.push(o);
      }
      return NextResponse.json({ ok: true, parties: out, installed: installed, sql_missing: installed ? null : SQL_MISSING_WF, can_manage: canManage, can_closed_month: isSuper, can_totals: canTotals, api_build_marker: API_BUILD_MARKER });
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
