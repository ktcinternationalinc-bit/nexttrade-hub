// v55.83-QC — Manual CSV statement import (Max, Nov 7 11:52: "do we have a
// manual importer of csv if plaid is not working"). Built because Plaid's
// M&T connection delivered ONE transaction across four links — the 2-year
// history comes from the bank's own CSV export instead.
//
// Design rules:
//   - Rows land in bank_transactions SHAPED EXACTLY like Plaid rows
//     (same columns mapPlaidTransaction writes), so categorization, rules,
//     matching, transfers, Wave and every report treat them identically.
//   - Target is an EXISTING connected account (plaid_accounts row) — the
//     import inherits its silo; nothing is ever imported unassigned.
//   - DEDUPE BY DEFICIT: rows are grouped by (date, amount, direction,
//     normalized description); for each group only max(0, csv − stored)
//     rows import. Re-importing the same file adds NOTHING; legitimate
//     same-day identical charges are preserved; overlap with what Plaid
//     already pulled is skipped automatically.
//   - plaid_transaction_id = 'manual-' + sha1(account|key|occurrence):
//     deterministic, so the upsert is idempotent on top of the deficit rule.
//   - Validation never guesses: a bad row is reported, never "fixed".
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import { assertPermission } from '../../../../lib/server-permissions';
import { audit } from '../../../../lib/audit-server'; // v55.83-QI

function db() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
}
function r2(x) { return Math.round((Number(x) || 0) * 100) / 100; }
function normDesc(x) { return String(x || '').toLowerCase().replace(/\s+/g, ' ').trim().substring(0, 120); }
function isDate(x) { return /^\d{4}-\d{2}-\d{2}$/.test(String(x || '')); }

export async function POST(req) {
  try {
    var body = await req.json();
    var action = body.action;
    var userId = body.user_id;
    var d = db();
    if (!userId) { return NextResponse.json({ ok: false, error: 'user_id required.' }, { status: 401 }); }
    // v55.83-QB permission: importing statements is connection management.
    var gate = await assertPermission(d, userId, 'bank.connections', req);
    if (!gate.ok) { return NextResponse.json({ ok: false, error: 'CSV import needs the "Bank: Manage Connections" permission — grant it in Settings → Permissions.' }, { status: gate.status || 403 }); }

    if (action === 'targets') {
      var accs = await d.from('plaid_accounts').select('plaid_account_id, name, mask, wave_business_id, connection_id');
      if (accs.error) { return NextResponse.json({ ok: false, error: accs.error.message }, { status: 400 }); }
      var conns = await d.from('bank_connections').select('id, institution_name, status, wave_business_id');
      var cMap = {}; ((conns.data) || []).forEach(function (c) { cMap[c.id] = c; });
      var out = (accs.data || []).map(function (a) {
        var c = cMap[a.connection_id] || {};
        return { plaid_account_id: a.plaid_account_id, name: a.name || 'account', mask: a.mask || '',
          institution: c.institution_name || '(bank)', connection_status: c.status || '',
          wave_business_id: a.wave_business_id || c.wave_business_id || null };
      }).filter(function (a) { return !!a.wave_business_id; }); // never offer an unassigned target
      return NextResponse.json({ ok: true, accounts: out });
    }

    if (action === 'import_rows') {
      var target = String(body.target_plaid_account_id || '');
      if (!target) { return NextResponse.json({ ok: false, error: 'Pick the account these statement rows belong to.' }, { status: 400 }); }
      var acc = await d.from('plaid_accounts').select('plaid_account_id, name, mask, wave_business_id, connection_id').eq('plaid_account_id', target).maybeSingle();
      if (acc.error || !acc.data) { return NextResponse.json({ ok: false, error: 'Target account not found.' }, { status: 404 }); }
      var connQ = await d.from('bank_connections').select('id, institution_name, wave_business_id, business_id').eq('id', acc.data.connection_id).maybeSingle();
      var conn = (connQ && connQ.data) || {};
      var silo = acc.data.wave_business_id || conn.wave_business_id || null;
      if (!silo) { return NextResponse.json({ ok: false, error: 'That account is not assigned to an accounting silo yet — assign it in the Bank tab first (imports must land in a silo).' }, { status: 409 }); }

      var rowsIn = Array.isArray(body.rows) ? body.rows : [];
      if (!rowsIn.length) { return NextResponse.json({ ok: false, error: 'No rows to import.' }, { status: 400 }); }
      if (rowsIn.length > 2000) { return NextResponse.json({ ok: false, error: 'Send at most 2,000 rows per request (the importer chunks automatically).' }, { status: 400 }); }

      // Validate — bad rows are REPORTED, never guessed into the books.
      var good = []; var bad = 0; var badWhy = [];
      rowsIn.forEach(function (r0, i0) {
        var dt = String(r0.date || '');
        var dir = r0.direction === 'out' ? 'out' : r0.direction === 'in' ? 'in' : null;
        var amt = r2(r0.amount_abs);
        var nm = String(r0.name || '').trim().substring(0, 300);
        var why = null;
        if (!isDate(dt)) { why = 'row ' + (i0 + 1) + ': date must be YYYY-MM-DD (got "' + dt + '")'; }
        else if (!dir) { why = 'row ' + (i0 + 1) + ': direction must be in or out'; }
        else if (!(amt > 0) || amt > 100000000) { why = 'row ' + (i0 + 1) + ': amount must be a positive number'; }
        else if (!nm) { why = 'row ' + (i0 + 1) + ': empty description'; }
        if (why) { bad++; if (badWhy.length < 5) { badWhy.push(why); } return; }
        good.push({ date: dt, direction: dir, amount_abs: amt, name: nm, check_number: String(r0.check_number || '').trim() || null });
      });
      if (!good.length) { return NextResponse.json({ ok: false, error: 'Every row failed validation. ' + badWhy.join(' · ') }, { status: 400 }); }

      var minD = good[0].date; var maxD = good[0].date;
      good.forEach(function (g) { if (g.date < minD) { minD = g.date; } if (g.date > maxD) { maxD = g.date; } });

      // DEFICIT DEDUPE against EVERYTHING already stored for this account in
      // the window — Plaid rows and earlier imports alike.
      // v55.83-QD (Max): CSV and Plaid on the SAME account. Two tiers:
      //   1. EXACT key (date|amount|direction|normalized description) vs
      //      rows from EARLIER IMPORTS — re-importing the same file is a
      //      no-op, while two legit same-day same-amount different-vendor
      //      lines both import.
      //   2. NAMELESS key (date|amount|direction) vs PLAID rows — a bank's
      //      CSV wording never matches Plaid's wording, so overlap with
      //      Plaid is caught by amount+date+direction, counted per
      //      occurrence (legit twins survive because the CSV carries both
      //      lines and Plaid carries both slots).
      var ex = await d.from('bank_transactions')
        .select('id, date, posted_date, amount_abs, direction, name, plaid_transaction_id')
        .eq('account_id', target).gte('date', minD).lte('date', maxD).limit(20000);
      if (ex.error) { return NextResponse.json({ ok: false, error: ex.error.message }, { status: 400 }); }
      var manualCount = {}; var plaidCount = {};
      (ex.data || []).forEach(function (t0) {
        var base0 = (t0.posted_date || t0.date) + '|' + r2(t0.amount_abs).toFixed(2) + '|' + t0.direction;
        if (/^manual-/.test(String(t0.plaid_transaction_id || ''))) { var k0 = base0 + '|' + normDesc(t0.name); manualCount[k0] = (manualCount[k0] || 0) + 1; }
        else { plaidCount[base0] = (plaidCount[base0] || 0) + 1; }
      });
      var usedManual = {}; var usedPlaid = {}; var insCount = {}; var toInsert = []; var skippedExisting = 0;
      good.forEach(function (g) {
        var nk = g.date + '|' + g.amount_abs.toFixed(2) + '|' + g.direction;
        var k = nk + '|' + normDesc(g.name);
        if ((usedManual[k] || 0) < (manualCount[k] || 0)) { usedManual[k] = (usedManual[k] || 0) + 1; skippedExisting++; return; } // an earlier import already has it
        if ((usedPlaid[nk] || 0) < (plaidCount[nk] || 0)) { usedPlaid[nk] = (usedPlaid[nk] || 0) + 1; skippedExisting++; return; } // Plaid already pulled it (wording differs, money matches)
        insCount[k] = (insCount[k] || 0) + 1;
        var occ = (manualCount[k] || 0) + insCount[k]; // deterministic + collision-free vs existing manual ids
        var mid = 'manual-' + crypto.createHash('sha1').update(target + '|' + k + '|' + occ).digest('hex');
        toInsert.push({
          connection_id: acc.data.connection_id || null,
          business_id: conn.business_id || null,
          wave_business_id: silo,
          bank_source: '[CSV] ' + (conn.institution_name || 'statement'),
          plaid_transaction_id: mid,
          account_id: target,
          date: g.date,
          posted_date: g.date,
          authorized_date: null,
          amount: g.direction === 'out' ? g.amount_abs : -g.amount_abs, // Plaid convention: positive = money out
          amount_abs: g.amount_abs,
          direction: g.direction,
          iso_currency: 'USD',
          name: g.name,
          merchant_name: null,
          category: '',
          channel: 'statement_import',
          transaction_code: null,
          check_number: g.check_number,
          pending: false,
          pending_transaction_id: null,
          raw: { source: 'csv_statement_import', imported_by: userId, imported_at: new Date().toISOString() },
          updated_at: new Date().toISOString(),
        });
      });
      var inserted = 0;
      if (toInsert.length) {
        // Idempotent on plaid_transaction_id, same as the Plaid sync; a
        // re-run never clobbers review status / classification / matches
        // because this payload only carries bank-sourced fields.
        var up = await d.from('bank_transactions').upsert(toInsert, { onConflict: 'plaid_transaction_id' });
        if (up.error) { return NextResponse.json({ ok: false, error: up.error.message }, { status: 500 }); }
        inserted = toInsert.length;
      }
      await audit(d, userId, 'statement_rows_imported', 'plaid_account', target, { imported: inserted, skipped_existing: skippedExisting, skipped_bad: bad, window: { from: minD, to: maxD } }); // v55.83-QI
      return NextResponse.json({ ok: true, imported: inserted, skipped_existing: skippedExisting, skipped_bad: bad,
        bad_examples: badWhy, window: { from: minD, to: maxD },
        account: { name: acc.data.name, mask: acc.data.mask } });
    }

    return NextResponse.json({ ok: false, error: 'Unknown action "' + action + '".' }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e && e.message) || 'Server error' }, { status: 500 });
  }
}
