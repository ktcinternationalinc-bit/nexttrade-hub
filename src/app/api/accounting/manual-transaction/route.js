// v55.83-TQ — /api/accounting/manual-transaction (Max, Nov 17: "create functionality where super admin or permissioned can add
// transactions"). Adds ONE bank transaction by hand, shaped exactly like a statement-import line (same columns as a Plaid row), so
// categorizing, rules, matching, transfers and every report treat it the same.
//   POST { action: 'accounts' }  → the accounts this person may add to (assigned to a silo; never a private one they can't see)
//   POST { action: 'add', plaid_account_id, date, direction, amount, description, check_number?, request_id, confirm_duplicate? }
// Only the SUPER ADMIN, or a person the super admin switched on for 'bank.add_transactions' (never from a role).
// Verified sign-in; fails closed; one line per click (request_id); a line that looks already there needs confirm_duplicate.
// When the same transaction later arrives from the bank (Codex QA 17 Nov — the exact behaviour):
//   • same account, same posted date, same amount and in/out → the bank's copy is SKIPPED at the sync, WHATEVER its description
//     (the skip compares account, date, amount and direction only — counted like a statement twin);
//   • a different date: both stay. The duplicate check lists the pair for a person only when it is close: same description and
//     up to 1 day apart → "likely"; different description and up to 3 days apart → "possible". Further apart is not flagged.
//   • nothing is removed automatically on a near match (labels: "Entered by hand" / "Uploaded statement" / "Bank feed").
// SWC-safe: var + string concatenation only.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import { verifiedCaller } from '../../../../lib/verified-caller';
import { loadUserPermissions, userHasPermission } from '../../../../lib/server-permissions';
import { privateScope } from '../../../../lib/private-accounts-server';
import { audit } from '../../../../lib/audit-server';
import { autoTwinCheck } from '../../../../lib/duplicates-server';
import { payrollBillScope, payrollFilteredDb, requestNamesPayroll, payrollLinesNote } from '../../../../lib/payroll-bills'; // v55.83-ZD rev3 — payroll bank lines

var API_BUILD_MARKER = 'v55.83-TQ-manual-transaction';
export var ADD_PERMISSION = 'bank.add_transactions';
function admin() { return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } }); }
function bad(msg, st, extra) { return NextResponse.json(Object.assign({ ok: false, error: msg, api_build_marker: API_BUILD_MARKER }, extra || {}), { status: st || 400 }); }
function r2(x) { return Math.round((Number(x) || 0) * 100) / 100; }
// a REAL calendar date (Codex QA 17 Nov: 2026-02-30 used to pass because Date.parse rolls it over)
export function isDate(x) {
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(x || '')); if (!m) { return false; }
  var d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}
// Codex QA 17 Nov (P2 #1/#2) — a repeat of the same click is only "already added" when the SAVED line has exactly the details
// sent now (account, date, in/out, amount to the cent, description, check number). Anything changed → 409, form stays open.
var REPLAY_COLS = 'id, account_id, date, direction, amount_abs, name, check_number';
export function samePayload(saved, want) {
  if (!saved) { return false; }
  return String(saved.account_id || '') === want.account && String(saved.date || '').substring(0, 10) === want.date && saved.direction === want.direction &&
    Math.round(Number(saved.amount_abs) * 100) === Math.round(want.amount * 100) && String(saved.name || '') === want.description &&
    String(saved.check_number || '') === String(want.check_number || '');
}
function replayAnswer(saved, want) {
  if (samePayload(saved, want)) { return NextResponse.json({ ok: true, id: saved.id, already_added: true, api_build_marker: API_BUILD_MARKER }); }
  return bad('This click was already saved, but with different details (' + String(saved.date || '').substring(0, 10) + ' · ' + (saved.direction === 'in' ? 'in' : 'out') + ' $' + r2(saved.amount_abs).toFixed(2) + ' · “' + String(saved.name || '').substring(0, 60) + '”). Nothing was changed. To add your new details as a SEPARATE line press “Make it a new line”, then Add; to fix the saved one, edit it in the list.', 409, { changed_after_save: true, saved_id: saved.id });
}

export async function POST(req) {
  var db = admin();
  try {
    var body = await req.json().catch(function () { return {}; });
    var who = await verifiedCaller(req, body, createClient);
    if (who.error) { return bad(who.error, who.status || 401); }
    var userId = who.userId;
    var ctx = await loadUserPermissions(db, userId);
    if (!(ctx.isSuperAdmin === true || userHasPermission(ctx, ADD_PERMISSION))) { return bad('Adding a transaction by hand needs “Bank: Add transactions”, which only the super admin can switch on.', 403); }
    var payZD = await payrollBillScope(db, userId); if (payZD.error) { return Response.json({ ok: false, error: payZD.error }, { status: payZD.status }); } // v55.83-ZD rev3 — payroll bank lines: super admin + P&L only
    if (requestNamesPayroll(payZD, body)) { return Response.json({ ok: false, error: 'Not found.' }, { status: 404 }); }
    db = payrollFilteredDb(db, payZD);
    var scope = await privateScope(db, userId);
    if (scope.error) { return bad(scope.error + ' — nothing was added.', 503); }

    if (body.action === 'accounts') {
      var a = await db.from('plaid_accounts').select('plaid_account_id, name, mask, wave_business_id, connection_id, type, subtype');
      if (a.error) { return bad('Could not read the accounts (' + a.error.message + ').', 503); }
      // an account belongs to a company through itself or its bank connection (same rule as the statement import)
      var cs = await db.from('bank_connections').select('id, wave_business_id');
      if (cs.error) { return bad('Could not read the bank connections (' + cs.error.message + ').', 503); }
      var connSilo = {}; (cs.data || []).forEach(function (c) { connSilo[c.id] = c.wave_business_id || null; });
      var list = (a.data || []).filter(function (x) { return (x.wave_business_id || connSilo[x.connection_id]) && !(scope.hidden && scope.hidden[x.plaid_account_id]); })
        .map(function (x) { return { plaid_account_id: x.plaid_account_id, label: (x.name || 'Account') + (x.mask ? ' ••' + x.mask : '') + (x.subtype ? ' · ' + x.subtype : '') }; })
        .sort(function (p, q) { return p.label.localeCompare(q.label); });
      return NextResponse.json({ ok: true, accounts: list, api_build_marker: API_BUILD_MARKER });
    }

    if (body.action === 'add') {
      var target = String(body.plaid_account_id || '');
      var dt = String(body.date || ''); var dir = body.direction === 'out' ? 'out' : body.direction === 'in' ? 'in' : null;
      var amt = r2(String(body.amount || '').replace(/[$,\s]/g, ''));
      var desc = String(body.description || '').trim().substring(0, 300);
      var reqId = typeof body.request_id === 'string' && body.request_id.length >= 8 ? body.request_id.substring(0, 80) : null;
      if (!target) { return bad('Pick the account.'); }
      if (!isDate(dt)) { return bad('Enter the date (YYYY-MM-DD).'); }
      if (!dir) { return bad('Choose money IN or money OUT.'); }
      if (!(amt > 0) || amt > 100000000) { return bad('Enter an amount above zero.'); }
      if (!desc) { return bad('Enter a description (who paid / who was paid, and what for).'); }
      if (!reqId) { return bad('Refresh the page and try again (missing request id).'); }
      if (scope.hidden && scope.hidden[target]) { return bad('That account is not available to you.', 403); }
      var mid = 'manual-hand-' + crypto.createHash('sha1').update(target + '|' + reqId).digest('hex');
      // the same click again (lost answer) → the line already exists: return it, never a second one
      var want = { account: target, date: dt, direction: dir, amount: amt, description: desc, check_number: String(body.check_number || '').trim() || '' };
      var again = await db.from('bank_transactions').select(REPLAY_COLS).eq('plaid_transaction_id', mid).maybeSingle();
      if (again.error) { return bad('Could not check for this entry (' + again.error.message + ') — nothing was added.', 503); }
      if (again.data) { return replayAnswer(again.data, want); }
      var acc = await db.from('plaid_accounts').select('plaid_account_id, name, mask, wave_business_id, connection_id').eq('plaid_account_id', target).maybeSingle();
      if (acc.error) { return bad('Could not read the account (' + acc.error.message + ') — nothing was added.', 503); }
      if (!acc.data) { return bad('That account was not found.', 404); }
      var conn = { business_id: null, institution_name: null, wave_business_id: null };
      if (acc.data.connection_id) {
        var cq = await db.from('bank_connections').select('id, institution_name, wave_business_id, business_id').eq('id', acc.data.connection_id).maybeSingle();
        if (cq.error) { return bad('Could not read the bank connection (' + cq.error.message + ') — nothing was added.', 503); }
        conn = cq.data || conn;
      }
      var silo = acc.data.wave_business_id || conn.wave_business_id || null;
      if (!silo) { return bad('That account is not assigned to a company yet — assign it on the Bank screen first.', 409); }
      // looks already there? (same account, date, amount, direction) → ask first
      var ex = await db.from('bank_transactions').select('id, name, date, amount_abs, direction, review_status').eq('account_id', target).eq('date', dt).eq('direction', dir).gte('amount_abs', amt - 0.005).lte('amount_abs', amt + 0.005);
      if (ex.error) { return bad('Could not check for duplicates (' + ex.error.message + ') — nothing was added.', 503); }
      var same = (ex.data || []).filter(function (t) { return t.review_status !== 'duplicate'; });
      if (same.length && body.confirm_duplicate !== true) {
        return bad('This account already has ' + same.length + ' line(s) on ' + dt + ' for $' + amt.toFixed(2) + ' ' + (dir === 'in' ? 'in' : 'out') + ': ' + same.slice(0, 3).map(function (t) { return '“' + (t.name || '') + '”'; }).join(', ') + '. Add it anyway only if it is a different transaction.', 409, { possible_duplicates: same.slice(0, 5) });
      }
      var uN = await db.from('users').select('name, email').eq('id', userId).maybeSingle();
      var byName = (uN && uN.data && (uN.data.name || uN.data.email)) || 'a Hub user';
      var now = new Date().toISOString();
      var row = {
        connection_id: acc.data.connection_id || null, business_id: conn.business_id || null, wave_business_id: silo,
        bank_source: '[HAND] entered by ' + byName, plaid_transaction_id: mid, account_id: target,
        date: dt, posted_date: dt, authorized_date: null,
        amount: dir === 'out' ? amt : -amt, amount_abs: amt, direction: dir, iso_currency: 'USD', // Plaid convention: positive = money out
        name: desc, merchant_name: null, category: '', channel: 'manual_entry', transaction_code: null,
        check_number: String(body.check_number || '').trim() || null, pending: false, pending_transaction_id: null,
        raw: { source: 'hand_entry', entered_by: userId, entered_by_name: byName, entered_at: now, request_id: reqId }, updated_at: now
      };
      var ins = await db.from('bank_transactions').insert(row).select('id').maybeSingle();
      if (ins.error) {
        // a clash on save: success ONLY if the matching saved line is found AND has the same details (Codex QA 17 Nov P2 #2)
        if (ins.error.code === '23505' || /duplicate key|unique/i.test(String(ins.error.message))) {
          var a2 = await db.from('bank_transactions').select(REPLAY_COLS).eq('plaid_transaction_id', mid).maybeSingle();
          if (a2.error) { return bad('Saving clashed with another save and the check afterwards failed (' + a2.error.message + '). Refresh the list before trying again.', 503); }
          if (!a2.data) { return bad('Not added — the save clashed with another record (' + ins.error.message + '). Refresh the list before trying again.', 409); }
          return replayAnswer(a2.data, want);
        }
        return bad('Not added (' + ins.error.message + ').', 500);
      }
      await audit(db, userId, 'bank_transaction_added_by_hand', 'bank_transaction', ins.data.id, { account: (acc.data.name || '') + (acc.data.mask ? ' ••' + acc.data.mask : ''), date: dt, direction: dir, amount: amt, description: desc, request_id: reqId });
      // the duplicate check pairs it with the bank's own copy later; not run when the person said "add anyway" (a real second line)
      if (body.confirm_duplicate !== true) { try { await autoTwinCheck(db, { actorId: userId, budgetMs: 4000 }); } catch (eT) { /* also runs after every bank sync */ } }
      return NextResponse.json({ ok: true, id: ins.data.id, api_build_marker: API_BUILD_MARKER });
    }
    return bad('Unknown action.');
  } catch (e) { return bad((e && e.message) || 'failed', 500); }
}
