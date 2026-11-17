// /api/accounting/advances — v55.83-TX. PAYING NEXTRADE / RTM: bills · extra professional fee · ADVANCE (Max, Nov 17 2026).
//   summary  — per company (paid_through_parties): advance balance, fees on record, the payments sent to it (and what is
//              still unsplit on each), its open bills, and every entry with who / when / why. Needs Bills: View or
//              "advances.manage".
//   split    — part of a payment already sent → extra fee and / or advance            ┐ MONEY ACTIONS: only for the verified
//   apply    — use part of the advance to pay one of that company's bills              │ signed-in person with
//   to_fee   — turn part of the advance into a professional fee (reason required)      │ "advances.manage"; one id per click;
//   to_advance — turn part of the fees back into advance (reason required)             ┘ done ONLY by the database function
//              hub_party_money (locks, never below zero, append-only) — nothing is computed and written here.
// Nothing is automatic: a person chooses each move. Fails closed on any read error. SWC-safe: var + concatenation only.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { assertPermission } from '../../../../lib/server-permissions';
import { verifiedCaller } from '../../../../lib/verified-caller';
import { audit } from '../../../../lib/audit-server';
import { US_WAVE_BUSINESS_ID } from '../../../../lib/business-of';
// v55.83-TX — balances / privacy come from the database over the complete ledger (hub_party_pool_status)
import { privateScope, dropPrivate } from '../../../../lib/private-accounts-server'; // v55.83-TP private bank accounts

var API_BUILD_MARKER = 'v55.83-TX-advances';
var SQL_MISSING = 'Advances and extra fees need one database update first: run sql/v55-83-TX-advances-fees.sql in Supabase (SQL Editor) — after sql/v55-83-TO-payment-guards.sql.';
var MONEY = { split: 1, apply: 1, to_fee: 1, to_advance: 1 };

function admin() { return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } }); }
function r2(x) { return Math.round((Number(x) || 0) * 100) / 100; }
function fail(m, s) { return NextResponse.json({ ok: false, error: m }, { status: s || 400 }); }
function missingRel(e) { return /does not exist|schema cache|Could not find/i.test(String((e && e.message) || '')); }
function readFail(what, e) { return NextResponse.json({ ok: false, error: missingRel(e) ? SQL_MISSING : 'Could not read ' + what + ' (' + ((e && e.message) || 'error') + ') — nothing was changed.' }, { status: missingRel(e) ? 409 : 503 }); }

export async function POST(req) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) { return fail('Server key missing.', 500); }
  var db = admin();
  try {
    var body = await req.json();
    var action = String(body.action || '');
    if (action !== 'summary' && !MONEY[action]) { return fail('Unknown action.'); }
    var who = await verifiedCaller(req, body, createClient);
    if (who.error) { return fail(who.error, who.status || 401); }
    var userId = who.userId;
    var gA = await assertPermission(db, userId, 'accounting.view', req);
    if (!gA || gA.ok !== true) { return fail('This needs "Accounting Access" (P1).', 403); }
    var gM = await assertPermission(db, userId, 'advances.manage', req);
    var canMove = !!(gM && gM.ok === true);
    if (MONEY[action] && !canMove) { return fail('Moving advances and fees needs the "Advances: Manage" permission — ask the super admin.', 403); }
    if (!canMove) { var gV = await assertPermission(db, userId, 'bills.view', req); if (!gV || gV.ok !== true) { gV = await assertPermission(db, userId, 'bills.manage', req); } if (!gV || gV.ok !== true) { return fail('This needs the "Bills: View" permission.', 403); } }

    var pr = await db.from('paid_through_parties').select('name, kind');
    if (pr.error) { return readFail('the companies', pr.error); }
    var parties = pr.data || [];

    // v55.83-TX (Codex 17 Nov 19:50) — privacy and balances come from ONE complete, fail-closed source: the database, over the
    // WHOLE ledger (hub_party_pool_status / hub_party_pool_restricted). No capped or paged list is ever used as the ledger.
    // A person not allowed to see some private accounts gets them passed to the database; a pool holding ANY money from
    // them (or from a bank line that is missing / has no account) is hidden as a whole and cannot be moved by that person.
    var scope = await privateScope(db, userId);
    if (scope.error) { return fail(scope.error + (MONEY[action] ? ' — nothing was moved.' : ' — nothing shown.'), 503); }
    var hiddenArr = scope.all ? null : Object.keys(scope.hidden || {});

    if (action === 'summary') {
      var st = await db.rpc('hub_party_pool_status', { p_hidden_accounts: hiddenArr || [] });
      if (st.error) { return missingRel(st.error) || /hub_party_pool_status/.test(String(st.error.message || '')) ? NextResponse.json({ ok: true, sql_missing: SQL_MISSING, parties: parties.map(function (p) { return { name: p.name, kind: p.kind, advance: null, fee: null, balance_hidden: 'database update not run yet', payments: [], open_bills: [], entries: [] }; }) }) : readFail('the advance balances', st.error); }
      var status = {}; (st.data || []).forEach(function (r) { status[String(r.party).toLowerCase()] = r; });
      var gTotA = await assertPermission(db, userId, 'accounting.view_totals', req);
      var canTotalsA = !!(gTotA && gTotA.ok === true);
      var since = new Date(Date.now() - 200 * 86400000).toISOString().substring(0, 10);
      var ln = await db.from('bank_transactions').select('id, date, name, amount_abs, third_party_payer, account_id').eq('wave_business_id', US_WAVE_BUSINESS_ID).eq('direction', 'out').not('third_party_payer', 'is', null).neq('pending', true).gte('date', since).order('date', { ascending: false }).limit(500);
      if (ln.error) { return readFail('the payments', ln.error); }
      ln.data = dropPrivate(ln.data, scope);
      var lineIds = (ln.data || []).map(function (l) { return l.id; });
      var usedBy = {};
      for (var i = 0; i < lineIds.length; i += 200) {
        var ids = lineIds.slice(i, i + 200);
        var pq = await db.from('vendor_bill_payments').select('bank_transaction_id, amount, voided').in('bank_transaction_id', ids);
        if (pq.error) { return readFail('the bill payments', pq.error); }
        (pq.data || []).forEach(function (p) { if (p.voided !== true) { usedBy[p.bank_transaction_id] = r2((usedBy[p.bank_transaction_id] || 0) + Number(p.amount)); } });
        var sq = await db.from('party_money_entries').select('bank_transaction_id, amount').eq('kind', 'payment_split').in('bank_transaction_id', ids);
        if (sq.error) { return readFail('the advance entries', sq.error); }
        (sq.data || []).forEach(function (e) { usedBy[e.bank_transaction_id] = r2((usedBy[e.bank_transaction_id] || 0) + Number(e.amount)); });
        var wq = await db.from('wire_packages').select('bank_transaction_id, fee_amount, status').in('bank_transaction_id', ids);
        if (!wq.error) { (wq.data || []).forEach(function (w) { if (w.status === 'attached' && Number(w.fee_amount) > 0) { usedBy[w.bank_transaction_id] = r2((usedBy[w.bank_transaction_id] || 0) + Number(w.fee_amount)); } }); }
      }
      var bq = await db.from('vendor_bills').select('id, vendor_name, bill_number, bill_date, due_date, total_amount, paid_via, record_status, category').eq('wave_business_id', US_WAVE_BUSINESS_ID).eq('record_status', 'active').not('paid_via', 'is', null).limit(3000);
      if (bq.error) { return readFail('the bills', bq.error); }
      var billIds = (bq.data || []).map(function (b) { return b.id; }); var paid = {};
      for (var k = 0; k < billIds.length; k += 200) {
        var pb = await db.from('vendor_bill_payments').select('bill_id, amount, voided').in('bill_id', billIds.slice(k, k + 200));
        if (pb.error) { return readFail('the bill payments', pb.error); }
        (pb.data || []).forEach(function (p) { if (p.voided !== true) { paid[p.bill_id] = r2((paid[p.bill_id] || 0) + Number(p.amount)); } });
      }
      var out = [];
      for (var pi = 0; pi < parties.length; pi++) {
        var pp = parties[pi]; var key = String(pp.name).toLowerCase(); var s0 = status[key] || { advance: 0, fee: 0, entries: 0, restricted: false };
        var hid = !scope.all && s0.restricted === true;
        var showBal = canTotalsA && !hid;
        // the history shown on screen: the latest 200 moves of a pool this person may see (DISPLAY only — never summed)
        var hist = [];
        if (!hid && Number(s0.entries) > 0) {
          var hq = await db.from('party_money_entries').select('id, party, bucket, amount, kind, bank_transaction_id, bill_id, action_id, entry_date, reason, created_by, created_at').eq('party', pp.name).order('created_at', { ascending: false }).limit(200);
          if (hq.error) { return readFail('the advance history', hq.error); }
          hist = hq.data || [];
        }
        out.push({ name: pp.name, kind: pp.kind, advance: showBal ? Number(s0.advance) || 0 : null, fee: showBal ? Number(s0.fee) || 0 : null,
          balance_hidden: showBal ? null : (hid ? 'includes money from a private account' : 'needs the Bank & Financial Summary permission'),
          history_note: hid ? null : (Number(s0.entries) > hist.length ? 'latest ' + hist.length + ' of ' + s0.entries + ' moves shown' : null),
          payments: (ln.data || []).filter(function (l) { return String(l.third_party_payer).toLowerCase() === key; }).map(function (l) { return { id: l.id, date: l.date, name: l.name, amount: r2(l.amount_abs), used: usedBy[l.id] || 0, left: r2(Number(l.amount_abs) - (usedBy[l.id] || 0)) }; }),
          open_bills: (bq.data || []).filter(function (b) { return String(b.paid_via).toLowerCase() === key && r2(Number(b.total_amount) - (paid[b.id] || 0)) > 0.005; }).map(function (b) { return Object.assign({}, b, { open: r2(Number(b.total_amount) - (paid[b.id] || 0)) }); }),
          entries: hist, can_move_pool: canMove && !hid });
      }
      var userIds = {}; out.forEach(function (o) { o.entries.forEach(function (e) { if (e.created_by) { userIds[e.created_by] = true; } }); });
      var uids = Object.keys(userIds); var names = {};
      if (uids.length) { var uq = await db.from('users').select('id, name, email').in('id', uids.slice(0, 200)); ((uq && uq.data) || []).forEach(function (u) { names[u.id] = u.name || u.email || 'someone'; }); }
      out.forEach(function (o) { o.entries = o.entries.map(function (e) { return Object.assign({}, e, { by_name: names[e.created_by] || '' }); }); });
      return NextResponse.json({ ok: true, parties: out, can_move: canMove, api_build_marker: API_BUILD_MARKER });
    }

    // ── money actions: only through the database function, which re-checks the private-money rule over the WHOLE ledger,
    //    under the company's lock, in the same transaction as the move ──
    var party = parties.filter(function (p) { return p.name === body.party; })[0];
    if (!party) { return fail('Pick NextTrade or RTM.'); }
    var inst = await db.rpc('hub_party_money_installed');
    if (inst.error || inst.data !== true) { return fail(SQL_MISSING, 409); }
    var reqId = typeof body.request_id === 'string' && body.request_id.trim().length >= 8 ? body.request_id.trim().substring(0, 80) : null;
    if (!reqId) { return fail('Refresh the page and try again (missing click id).'); }
    var map = { split: 'split', apply: 'apply', to_fee: 'to_fee', to_advance: 'to_advance' };
    var rpc = await db.rpc('hub_party_money', {
      p_action: map[action], p_party: party.name, p_amount: r2(body.amount), p_fee: r2(body.fee),
      p_bank_txn: action === 'split' ? (body.bank_transaction_id || null) : null, p_bill: action === 'apply' ? (body.bill_id || null) : null,
      p_reason: String(body.reason || '').trim().substring(0, 500) || null, p_actor: userId, p_request_id: reqId,
      p_hidden_accounts: hiddenArr }); // null = may see every private account; otherwise the database refuses a pool with money from them
    if (rpc.error) {
      var m = String(rpc.error.message || '');
      if (/HUB_GUARD:/.test(m)) { return fail('Not done — ' + m.replace(/^[\s\S]*HUB_GUARD:\s*/, '') + ' Nothing was moved.', 409); }
      if (rpc.error.code === '23505') { return NextResponse.json({ ok: true, repeat: true }); }
      return fail('Not done (' + (m || 'database error') + '). Nothing was moved.', 500);
    }
    await audit(db, userId, 'party_money_' + action, 'party', party.name, { amount: r2(body.amount), fee: action === 'split' ? r2(body.fee) : undefined, bank_transaction_id: body.bank_transaction_id || undefined, bill_id: body.bill_id || undefined, reason: body.reason || null, result: rpc.data });
    return NextResponse.json({ ok: true, result: rpc.data });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e && e.message) || 'error', api_build_marker: API_BUILD_MARKER }, { status: 500 });
  }
}
