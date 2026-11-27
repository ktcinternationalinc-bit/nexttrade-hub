// v55.83-SO — CHECK FOR DUPLICATES (Max, Nov 15 2026):
//   "Add a clearly labeled 'Check for duplicates' button. … Let me review matches side by side and choose
//    the transaction to retain. Confirmed duplicates must disappear from normal screens and be excluded
//    consistently … Preserve the original record and an audit trail, with an option to restore it."
//
// RULES OF THIS ROUTE:
// • Nothing is removed automatically. A person confirms every removal (one by one, or a listed batch).
// • The two transactions must be the same amount, direction, currency and company — enforced again
//   in the database function, not only here.
// • A transaction that carries accounting work (invoice match, transfer link, split, bill payment,
//   wire) is never the one removed.
// • Removal MOVES the row out of bank_transactions (whole, into bank_transaction_duplicates) so every
//   total, screen, export, report and the ledger stop counting it. Restore puts it back exactly.
// • Permission: Accounting Access + bank.classify; restore and batch removal the same.
import { verifiedCaller } from '../../../../lib/verified-caller'; // v55.83-WQ — the route acts only for the verified signed-in person
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { assertPermission } from '../../../../lib/server-permissions';
import { audit } from '../../../../lib/audit-server';
import { findDuplicates, realAccounts, pairKey } from '../../../../lib/duplicate-detect';
import { loadBankAccounts, loadBankRows, protectedReasons, loadDismissed, DUP_COLS } from '../../../../lib/duplicates-server';
import { payrollBillScope, payrollFilteredDb, requestNamesPayroll, payrollLinesNote } from '../../../../lib/payroll-bills'; // v55.83-ZD rev3 — payroll bank lines

var API_BUILD_MARKER = 'v55.83-SO-duplicates';
export var maxDuration = 60;

function admin() { return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY); }
function isUuid(s) { return typeof s === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s); }
function needsSql(msg) { return /bank_duplicate_|bank_transaction_duplicates|schema cache|does not exist/i.test(String(msg || '')); }
function sqlNote() { return 'The duplicate records are not set up yet — run the v55.83-SO SQL in Supabase first.'; }

async function removeOne(db, dupId, keepId, by, reason) {
  var r = await db.rpc('bank_duplicate_remove', { p_dup: dupId, p_keep: keepId || null, p_actor: by, p_reason: reason || '' });
  if (r.error) { return { ok: false, why: needsSql(r.error.message) ? sqlNote() : r.error.message, needs_sql: needsSql(r.error.message) }; }
  var res = r.data || {};
  if (res.ok === true) { await audit(db, by, 'bank_duplicate_removed', 'bank_transaction', dupId, { kept: keepId || null, amount: res.amount, date: res.date, reason: reason || '' }); }
  return res;
}

export async function POST(req) {
  try {
    var body = await req.json();
    var action = body.action;
    var db = admin();
    var whoWQ = await verifiedCaller(req, body, createClient); // v55.83-WQ (Codex 21 Nov, F3): never a user_id from the request
    if (whoWQ.error) { return NextResponse.json({ ok: false, error: whoWQ.error }, { status: whoWQ.status || 401 }); }
    var userId = whoWQ.userId;
    var gate1 = await assertPermission(db, userId, 'accounting.view', req);
    if (!gate1.ok) { return NextResponse.json({ ok: false, error: 'This needs "Accounting Access" — grant it in Settings → Banking & Accounting Access.', denied: true, api_build_marker: API_BUILD_MARKER }, { status: gate1.status || 403 }); }
    var gate = await assertPermission(db, userId, 'bank.classify', req);
    if (!gate.ok) { return NextResponse.json({ ok: false, error: gate.error, denied: true, api_build_marker: API_BUILD_MARKER }, { status: gate.status || 403 }); }
    var by = userId;
    var payZD = await payrollBillScope(db, userId); if (payZD.error) { return NextResponse.json({ ok: false, error: payZD.error }, { status: payZD.status }); } // v55.83-ZD rev3 — payroll bank lines: super admin + P&L only
    if (requestNamesPayroll(payZD, body)) { return NextResponse.json({ ok: false, error: 'Not found.' }, { status: 404 }); }
    db = payrollFilteredDb(db, payZD);

    // ── scan: propose groups; remove nothing ──
    if (action === 'scan') {
      var since = /^\d{4}-\d{2}-\d{2}$/.test(String(body.since || '')) ? body.since : null;
      var rows = await loadBankRows(db, since, 20000);
      var accounts = await loadBankAccounts(db);
      var real = realAccounts(accounts);
      var dismissed = await loadDismissed(db);
      var first = findDuplicates(rows, { real: real, dismissed: dismissed });
      var inGroups = [];
      first.groups.forEach(function (g) { g.rows.forEach(function (x) { inGroups.push(x.id); }); });
      var byId = {}; rows.forEach(function (t) { byId[t.id] = t; });
      var prot = await protectedReasons(db, inGroups.map(function (id) { return byId[id]; }));
      var onlyIds = null;
      if (body.created_since) {
        onlyIds = {};
        rows.forEach(function (t) { if (t.created_at && String(t.created_at) >= String(body.created_since)) { onlyIds[t.id] = true; } });
      }
      var res = findDuplicates(rows, { real: real, dismissed: dismissed, protectedIds: prot, onlyIds: onlyIds });
      res.groups.forEach(function (g) {
        g.rows.forEach(function (x) { x.protected_why = prot[x.id] || ''; });
        g.removable = g.rows.filter(function (x) { return !x.protected; }).length;
      });
      // rows parked earlier with the old "duplicate" mark — still in the table, shown so they can be removed properly
      var parked = rows.filter(function (t) { return t.review_status === 'duplicate'; }).map(function (t) {
        var ra = real[t.account_id] || {};
        return { id: t.id, date: String(t.posted_date || t.date || '').substring(0, 10), account: ra.label || 'Account', description: t.name || t.merchant_name || '', amount: Math.round((Number(t.amount_abs) || 0) * 100) / 100, direction: t.direction };
      });
      var removedCount = 0; var installed = true;
      try {
        var rc = await db.from('bank_transaction_duplicates').select('id', { count: 'exact', head: true }).eq('status', 'removed');
        if (rc.error) { installed = false; } else { removedCount = rc.count || 0; }
      } catch (eC) { installed = false; }
      return NextResponse.json({ ok: true, groups: res.groups.slice(0, 300), group_count: res.groups.length, stats: res.stats, parked: parked.slice(0, 500), parked_count: parked.length,
        removed_count: removedCount, installed: installed, truncated: rows.length >= 20000, since: since, api_build_marker: API_BUILD_MARKER });
    }

    // ── remove: one confirmed duplicate ──
    if (action === 'remove') {
      if (!isUuid(body.dup_id) || (body.keep_id && !isUuid(body.keep_id))) { return NextResponse.json({ ok: false, error: 'Pick the transaction to keep and the one to remove.', api_build_marker: API_BUILD_MARKER }, { status: 400 }); }
      var one = await removeOne(db, body.dup_id, body.keep_id || null, by, String(body.reason || '').substring(0, 300));
      if (one.ok !== true) { return NextResponse.json({ ok: false, error: one.why || 'Not removed.', blocked_by: one.blocked_by || null, needs_sql: one.needs_sql === true, api_build_marker: API_BUILD_MARKER }, { status: one.needs_sql ? 400 : 409 }); }
      return NextResponse.json({ ok: true, removed: one.removed, kept: one.kept, api_build_marker: API_BUILD_MARKER });
    }

    // ── remove_many: a batch the person saw listed and confirmed (each pair is still checked by the database) ──
    if (action === 'remove_many') {
      var pairs = Array.isArray(body.pairs) ? body.pairs.slice(0, 200) : [];
      var done = []; var failed = [];
      for (var i = 0; i < pairs.length; i++) {
        var p = pairs[i] || {};
        if (!isUuid(p.dup_id) || (p.keep_id && !isUuid(p.keep_id))) { failed.push({ dup_id: p.dup_id || null, why: 'Bad request.' }); continue; }
        var r1 = await removeOne(db, p.dup_id, p.keep_id || null, by, String(body.reason || '').substring(0, 300));
        if (r1.ok === true) { done.push(p.dup_id); } else {
          failed.push({ dup_id: p.dup_id, why: r1.why || 'Not removed.' });
          if (r1.needs_sql) { break; }
        }
      }
      return NextResponse.json({ ok: failed.length === 0, removed: done.length, failed: failed, api_build_marker: API_BUILD_MARKER });
    }

    // ── dismiss: "these are not duplicates" — remembered, never offered again ──
    if (action === 'dismiss') {
      var ids = (Array.isArray(body.ids) ? body.ids : []).filter(isUuid).slice(0, 12);
      if (ids.length < 2) { return NextResponse.json({ ok: false, error: 'Two or more transactions are needed.', api_build_marker: API_BUILD_MARKER }, { status: 400 }); }
      var ins = [];
      for (var a = 0; a < ids.length; a++) { for (var b = a + 1; b < ids.length; b++) {
        ins.push({ pair_key: pairKey(ids[a], ids[b]), a_id: ids[a], b_id: ids[b], note: String(body.note || '').substring(0, 300), dismissed_by: by });
      } }
      var dr = await db.from('bank_duplicate_dismissals').upsert(ins, { onConflict: 'pair_key' });
      if (dr.error) { return NextResponse.json({ ok: false, error: needsSql(dr.error.message) ? sqlNote() : dr.error.message, needs_sql: needsSql(dr.error.message), api_build_marker: API_BUILD_MARKER }, { status: 400 }); }
      await audit(db, by, 'bank_duplicate_dismissed', 'bank_transaction', ids.join('+'), { pairs: ins.length });
      return NextResponse.json({ ok: true, dismissed: ins.length, api_build_marker: API_BUILD_MARKER });
    }

    // ── removed_list: what was taken out, and what was put back ──
    if (action === 'removed_list') {
      var rl = await db.from('bank_transaction_duplicates').select('seq, id, kept_id, account_id, tx_date, direction, amount_abs, reason, status, removed_by, removed_at, restored_by, restored_at, row_data').order('removed_at', { ascending: false }).limit(500);
      if (rl.error) { return NextResponse.json({ ok: false, error: needsSql(rl.error.message) ? sqlNote() : rl.error.message, needs_sql: needsSql(rl.error.message), api_build_marker: API_BUILD_MARKER }, { status: 400 }); }
      var accs = realAccounts(await loadBankAccounts(db));
      var who = {};
      try {
        var us = await db.from('users').select('id, name, email');
        ((us && us.data) || []).forEach(function (u) { who[u.id] = u.name || u.email || ''; });
      } catch (eU) { /* names are a nicety */ }
      var list = (rl.data || []).map(function (x) {
        var rd = x.row_data || {};
        return { seq: x.seq, id: x.id, kept_id: x.kept_id, date: x.tx_date, direction: x.direction, amount: Number(x.amount_abs) || 0,
          account: (accs[x.account_id] && accs[x.account_id].label) || 'Account', description: rd.name || rd.merchant_name || '', reason: x.reason || '',
          status: x.status, removed_at: x.removed_at, removed_by: who[x.removed_by] || '', restored_at: x.restored_at, restored_by: who[x.restored_by] || '' };
      });
      return NextResponse.json({ ok: true, removed: list.filter(function (x) { return x.status === 'removed'; }), restored: list.filter(function (x) { return x.status === 'restored'; }), api_build_marker: API_BUILD_MARKER });
    }

    // ── restore: put it back exactly as it was ──
    if (action === 'restore') {
      if (!isUuid(body.id)) { return NextResponse.json({ ok: false, error: 'Which transaction?', api_build_marker: API_BUILD_MARKER }, { status: 400 }); }
      var rr = await db.rpc('bank_duplicate_restore', { p_id: body.id, p_actor: by });
      if (rr.error) { return NextResponse.json({ ok: false, error: needsSql(rr.error.message) ? sqlNote() : rr.error.message, api_build_marker: API_BUILD_MARKER }, { status: 400 }); }
      var out = rr.data || {};
      if (out.ok !== true) { return NextResponse.json({ ok: false, error: out.why || 'Not restored.', api_build_marker: API_BUILD_MARKER }, { status: 409 }); }
      await audit(db, by, 'bank_duplicate_restored', 'bank_transaction', body.id, { amount: out.amount, date: out.date });
      return NextResponse.json({ ok: true, restored: body.id, api_build_marker: API_BUILD_MARKER });
    }

    return NextResponse.json({ ok: false, error: 'Unknown action "' + action + '".', api_build_marker: API_BUILD_MARKER }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e && e.message) || 'Server error', api_build_marker: API_BUILD_MARKER }, { status: 500 });
  }
}
