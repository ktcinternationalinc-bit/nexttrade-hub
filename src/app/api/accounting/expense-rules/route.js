// v55.83-PI — EXPENSE CATEGORIES + RULES + VERIFIED (Max, Nov 6): "we need to
// be able to create categories to mark expenses.. automatically remember
// previous selections.. have a verified tab.. but verified will not prevent
// it from being counted against the expense.. rules automatically saved and
// updated if i manually change something.. a rules tab to create new rules."
//
// RULES OF THIS ROUTE:
// • Verified is a HUMAN STAMP only. It never excludes a transaction from any
//   expense total anywhere — nothing filters on category_verified but views.
// • Rules only ever FILL BLANKS (unreviewed + unclassified). A human pick is
//   never overwritten by a rule.
// • Categories/rules are deactivated, never deleted (accountability).
// • Permission: bank.classify (same permission that categorizes in Bank
//   Review); super admin always.
import { NextResponse } from 'next/server';
import { assertPermission } from '../../../../lib/server-permissions';
import { createClient } from '@supabase/supabase-js';
import { applyExpenseRules, waveAccountForCategory } from '../../../../lib/expense-rules-server';
import { audit } from '../../../../lib/audit-server'; // v55.83-QI
import { US_WAVE_BUSINESS_ID } from '../../../../lib/business-of';

var API_BUILD_MARKER = 'v55.83-PI-expense-rules';

function admin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
}
function slugify(label) {
  return String(label || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').substring(0, 60);
}

export async function POST(req) {
  try {
    var body = await req.json();
    var action = body.action;
    var db = admin();
    var userId = body.user_id || null;

    var gate = await assertPermission(db, userId, 'bank.classify', req);
    if (!gate.ok && (action === 'list' || action === 'save_category')) {
      // v55.83-PJ — the Bills screen shares the SAME category list and can add
      // to it: bills.manage unlocks ONLY list + save_category here. Rules,
      // verify and apply still require bank.classify.
      gate = await assertPermission(db, userId, 'bills.manage', req);
    }
    if (!gate.ok) { return NextResponse.json({ ok: false, error: gate.error, denied: true, api_build_marker: API_BUILD_MARKER }, { status: gate.status || 403 }); }
    var by = userId;

    // ── list: categories + rules in one call ──
    if (action === 'list') {
      var cats = await db.from('expense_categories').select('id, key, label, active, sort, kind, wave_account_id, wave_account_name').order('sort').order('label');
      if (cats.error) { return NextResponse.json({ ok: false, error: cats.error.message + ' — run sql/v55-83-PI-expense-categories-rules.sql first.', needs_sql: true, api_build_marker: API_BUILD_MARKER }, { status: 400 }); }
      var rules = await db.from('us_expense_rules').select('id, match_text, classification, auto_apply, active, source, hit_count, last_hit_at, updated_at').order('updated_at', { ascending: false }).limit(1000);
      return NextResponse.json({ ok: true, categories: cats.data || [], rules: (rules.data || []), api_build_marker: API_BUILD_MARKER });
    }

    // ── save_category: create (or relabel) a category ──
    if (action === 'save_category') {
      var label = String((body.payload && body.payload.label) || '').trim();
      if (label.length < 2) { return NextResponse.json({ ok: false, error: 'Category name must be at least 2 characters.', api_build_marker: API_BUILD_MARKER }, { status: 400 }); }
      if (body.payload && body.payload.id) {
        var cpatch = { label: label, updated_at: new Date().toISOString() };
        // v55.83-PW — QuickBooks-style type; whitelisted, never free text.
        var KINDS = ['income', 'cogs', 'expense', 'other_income', 'other_expense', 'transfer', 'not_pnl'];
        if (body.payload.kind !== undefined) {
          if (KINDS.indexOf(body.payload.kind) < 0) { return NextResponse.json({ ok: false, error: 'Unknown category type "' + body.payload.kind + '".', api_build_marker: API_BUILD_MARKER }, { status: 400 }); }
          cpatch.kind = body.payload.kind;
        }
        // v55.83-PQ — optional Wave account link ("all three places at once").
        // Passed explicitly (even as null = unlink); absent = untouched.
        if (Object.prototype.hasOwnProperty.call(body.payload, 'wave_account_id')) {
          cpatch.wave_account_id = body.payload.wave_account_id || null;
          cpatch.wave_account_name = body.payload.wave_account_name || null;
        }
        var updc = await db.from('expense_categories').update(cpatch).eq('id', body.payload.id).select();
        if (updc.error) { return NextResponse.json({ ok: false, error: updc.error.message, api_build_marker: API_BUILD_MARKER }, { status: 400 }); }
        return NextResponse.json({ ok: true, category: updc.data && updc.data[0], api_build_marker: API_BUILD_MARKER });
      }
      var key = slugify(label);
      if (key.length < 2) { return NextResponse.json({ ok: false, error: 'Category name needs letters or numbers.', api_build_marker: API_BUILD_MARKER }, { status: 400 }); }
      var insKind = 'expense';
      if (body.payload && body.payload.kind && ['income', 'cogs', 'expense', 'other_income', 'other_expense', 'transfer', 'not_pnl'].indexOf(body.payload.kind) >= 0) { insKind = body.payload.kind; }
      var insc = await db.from('expense_categories').insert({ key: key, label: label, kind: insKind, created_by: by }).select();
      if (insc.error) { return NextResponse.json({ ok: false, error: /duplicate|unique/i.test(insc.error.message) ? 'A category with that name already exists.' : insc.error.message, api_build_marker: API_BUILD_MARKER }, { status: 400 }); }
      return NextResponse.json({ ok: true, category: insc.data && insc.data[0], api_build_marker: API_BUILD_MARKER });
    }

    // ── toggle_category ──
    if (action === 'toggle_category') {
      var tg = await db.from('expense_categories').update({ active: body.payload && body.payload.active === true, updated_at: new Date().toISOString() }).eq('id', body.payload && body.payload.id).select();
      if (tg.error) { return NextResponse.json({ ok: false, error: tg.error.message, api_build_marker: API_BUILD_MARKER }, { status: 400 }); }
      return NextResponse.json({ ok: true, category: tg.data && tg.data[0], api_build_marker: API_BUILD_MARKER });
    }

    // ── save_rule: create or edit (manual from the Rules tab) ──
    if (action === 'save_rule') {
      var p = body.payload || {};
      var mt = String(p.match_text || '').trim().toLowerCase();
      if (mt.length < 3) { return NextResponse.json({ ok: false, error: 'Match text must be at least 3 characters (what the bank line contains).', api_build_marker: API_BUILD_MARKER }, { status: 400 }); }
      if (!p.classification) { return NextResponse.json({ ok: false, error: 'Pick the category this rule applies.', api_build_marker: API_BUILD_MARKER }, { status: 400 }); }
      var catok = await db.from('expense_categories').select('key').eq('key', p.classification).limit(1);
      if (!catok.error && (!catok.data || !catok.data.length)) { return NextResponse.json({ ok: false, error: 'Unknown category "' + p.classification + '".', api_build_marker: API_BUILD_MARKER }, { status: 400 }); }
      var patch = { match_text: mt, classification: p.classification, auto_apply: p.auto_apply !== false, active: p.active !== false, source: 'manual', updated_by: by, updated_at: new Date().toISOString() };
      if (p.id) {
        var updr = await db.from('us_expense_rules').update(patch).eq('id', p.id).select();
        if (updr.error) { return NextResponse.json({ ok: false, error: updr.error.message, api_build_marker: API_BUILD_MARKER }, { status: 400 }); }
        return NextResponse.json({ ok: true, rule: updr.data && updr.data[0], api_build_marker: API_BUILD_MARKER });
      }
      patch.created_by = by;
      var insr = await db.from('us_expense_rules').insert(patch).select();
      if (insr.error) { return NextResponse.json({ ok: false, error: /duplicate|unique/i.test(insr.error.message) ? 'A rule for that exact text already exists — edit it instead.' : insr.error.message, api_build_marker: API_BUILD_MARKER }, { status: 400 }); }
      return NextResponse.json({ ok: true, rule: insr.data && insr.data[0], api_build_marker: API_BUILD_MARKER });
    }

    // ── deactivate_rule: rules are turned off, never erased ──
    if (action === 'deactivate_rule') {
      var da = await db.from('us_expense_rules').update({ active: false, updated_by: by, updated_at: new Date().toISOString() }).eq('id', body.payload && body.payload.id).select();
      if (da.error) { return NextResponse.json({ ok: false, error: da.error.message, api_build_marker: API_BUILD_MARKER }, { status: 400 }); }
      return NextResponse.json({ ok: true, rule: da.data && da.data[0], api_build_marker: API_BUILD_MARKER });
    }

    // ── apply_rules: run the background matcher NOW ──
    if (action === 'apply_rules') {
      var resA = await applyExpenseRules(db, 500);
      if (resA.error) { return NextResponse.json({ ok: false, error: resA.error, api_build_marker: API_BUILD_MARKER }, { status: 400 }); }
      return NextResponse.json({ ok: true, result: resA, api_build_marker: API_BUILD_MARKER });
    }

    // ── expenses: the Verified / Unverified / All view ──
    if (action === 'expenses') {
      var filter = (body.payload && body.payload.filter) || 'unverified';
      var q = db.from('bank_transactions')
        .select('id, date, posted_date, amount_abs, name, merchant_name, classification, category_source, review_status, category_verified, category_verified_at, pending, transfer_group_id')
        .eq('wave_business_id', US_WAVE_BUSINESS_ID).eq('direction', 'out').neq('pending', true)
        .order('posted_date', { ascending: false }).limit(200);
      if (filter === 'verified') { q = q.eq('category_verified', true); }
      if (filter === 'unverified') { q = q.eq('category_verified', false).not('classification', 'is', null); }
      var ex = await q;
      if (ex.error) { return NextResponse.json({ ok: false, error: ex.error.message + (/category_verified/.test(ex.error.message) ? ' — run sql/v55-83-PI-expense-categories-rules.sql first.' : ''), needs_sql: /category_verified/.test(ex.error.message), api_build_marker: API_BUILD_MARKER }, { status: 400 }); }
      return NextResponse.json({ ok: true, expenses: ex.data || [], filter: filter, api_build_marker: API_BUILD_MARKER });
    }

    // ── verify / unverify: the human stamp. A FLAG ONLY — verified or not,
    //    the expense counts against expenses exactly the same. ──
    if (action === 'verify') {
      var want = !(body.payload && body.payload.verified === false);
      var txid = body.payload && body.payload.bank_transaction_id;
      if (!txid) { return NextResponse.json({ ok: false, error: 'bank_transaction_id required.', api_build_marker: API_BUILD_MARKER }, { status: 400 }); }
      var pre = await db.from('bank_transactions').select('id, classification, direction, review_status, matched_invoice_id').eq('id', txid);
      var prow = pre.data && pre.data[0];
      if (!prow) { return NextResponse.json({ ok: false, error: 'Transaction not found.', api_build_marker: API_BUILD_MARKER }, { status: 404 }); }
      if (want && !prow.classification) { return NextResponse.json({ ok: false, error: 'Pick a category first — verifying confirms the category.', api_build_marker: API_BUILD_MARKER }, { status: 400 }); }
      var vp = { category_verified: want, category_verified_by: want ? by : null, category_verified_at: want ? new Date().toISOString() : null };
      // Verifying an EXPENSE also advances unreviewed → reviewed (so the
      // ClickBooks bridge can post it). Out-direction, unmatched only — the
      // deposit money-conservation gate (v55.83-JG) stays untouched.
      if (want && prow.direction === 'out' && prow.review_status === 'unreviewed' && !prow.matched_invoice_id) {
        vp.review_status = 'reviewed'; vp.reviewed_by = by; vp.reviewed_at = new Date().toISOString();
      }
      var vr = await db.from('bank_transactions').update(vp).eq('id', txid).select();
      if (vr.error) { return NextResponse.json({ ok: false, error: vr.error.message, api_build_marker: API_BUILD_MARKER }, { status: 400 }); }
      await audit(db, by, 'category_verified_stamp', 'bank_transaction', body.payload && body.payload.bank_transaction_id, { verified: !!(body.payload && body.payload.verified) }); // v55.83-QI
      return NextResponse.json({ ok: true, row: vr.data && vr.data[0], api_build_marker: API_BUILD_MARKER });
    }

    // ── transfer_suggestions (v55.83-PR, Max 05:25: "must be able to read
    //    through accounts and give suggestions to transfers... and link them,
    //    in the proper accounting terminology") — scan the silo's accounts and
    //    PROPOSE intra-company transfer pairs: same amount to the cent,
    //    opposite direction, DIFFERENT account, within 7 days, neither leg
    //    paired or matched to an invoice. Suggestions only — a human links. ──
    if (action === 'transfer_suggestions') {
      var sinceS = new Date(Date.now() - 180 * 86400000).toISOString().substring(0, 10);
      var txS = await db.from('bank_transactions')
        .select('id, date, posted_date, amount_abs, direction, account_id, name, merchant_name, classification, transfer_group_id, matched_invoice_id')
        .eq('wave_business_id', US_WAVE_BUSINESS_ID).neq('pending', true)
        .is('transfer_group_id', null).is('matched_invoice_id', null)
        .gte('date', sinceS).order('date', { ascending: false }).limit(2000);
      if (txS.error) { return NextResponse.json({ ok: false, error: txS.error.message + (/transfer_group_id/.test(txS.error.message) ? ' — run the PQ SQL first.' : ''), api_build_marker: API_BUILD_MARKER }, { status: 400 }); }
      var accS = await db.from('plaid_accounts').select('plaid_account_id, name, mask');
      var acName = {};
      (accS.data || []).forEach(function (a8) { acName[a8.plaid_account_id] = (a8.name || 'account') + (a8.mask ? ' •' + a8.mask : ''); });
      var outs = []; var ins = [];
      (txS.data || []).forEach(function (t8) { (t8.direction === 'out' ? outs : t8.direction === 'in' ? ins : []).push(t8); });
      var hintRx = /transfer|xfer|trnsfr|internal|between accounts|payment to chk|payment to cc|crcardpmt|credit crd|card payment/i;
      var usedIn = {}; var pairs = [];
      for (var oi = 0; oi < outs.length && pairs.length < 50; oi++) {
        var O = outs[oi]; var best = null; var bestScore = -1;
        for (var ii = 0; ii < ins.length; ii++) {
          var I = ins[ii];
          if (usedIn[I.id]) { continue; }
          if ((I.account_id || '') === (O.account_id || '')) { continue; } // a transfer LEAVES one account and ARRIVES in another
          if (Math.abs((Number(I.amount_abs) || 0) - (Number(O.amount_abs) || 0)) > 0.005) { continue; }
          var gap = Math.abs(Math.round((Date.parse(I.posted_date || I.date) - Date.parse(O.posted_date || O.date)) / 86400000));
          if (gap > 7) { continue; }
          var score = (7 - gap) + (hintRx.test((O.merchant_name || '') + ' ' + (O.name || '')) ? 2 : 0) + (hintRx.test((I.merchant_name || '') + ' ' + (I.name || '')) ? 2 : 0);
          if (score > bestScore) { bestScore = score; best = { gap: gap, inTx: I }; }
        }
        if (best) {
          usedIn[best.inTx.id] = true;
          pairs.push({
            amount: Math.round((Number(O.amount_abs) || 0) * 100) / 100, days_apart: best.gap,
            out: { id: O.id, date: O.posted_date || O.date, account: acName[O.account_id] || 'account', who: O.merchant_name || O.name || '' },
            inn: { id: best.inTx.id, date: best.inTx.posted_date || best.inTx.date, account: acName[best.inTx.account_id] || 'account', who: best.inTx.merchant_name || best.inTx.name || '' },
          });
        }
      }
      pairs.sort(function (p8, q8) { return q8.amount - p8.amount; });
      return NextResponse.json({ ok: true, suggestions: pairs, scanned_since: sinceS, api_build_marker: API_BUILD_MARKER });
    }

    // ── transfers_report (v55.83-PR): the intra-company transfer register —
    //    every LINKED pair in a period, from-account → to-account, filter by
    //    dates, built for the accountant (both legs net to zero through the
    //    transfer clearing account in ClickBooks). ──
    if (action === 'transfers_report') {
      var tf = /^\d{4}-\d{2}-\d{2}$/.test(String((body.payload && body.payload.from) || '')) ? body.payload.from : '2026-01-01';
      var tt = /^\d{4}-\d{2}-\d{2}$/.test(String((body.payload && body.payload.to) || '')) ? body.payload.to : new Date().toISOString().substring(0, 10);
      var txR = await db.from('bank_transactions')
        .select('id, date, posted_date, amount_abs, direction, account_id, transfer_group_id')
        .eq('wave_business_id', US_WAVE_BUSINESS_ID).not('transfer_group_id', 'is', null)
        .gte('date', tf).lte('date', tt).limit(2000);
      if (txR.error) { return NextResponse.json({ ok: false, error: txR.error.message, api_build_marker: API_BUILD_MARKER }, { status: 400 }); }
      var accR = await db.from('plaid_accounts').select('plaid_account_id, name, mask');
      var acName2 = {};
      (accR.data || []).forEach(function (a9) { acName2[a9.plaid_account_id] = (a9.name || 'account') + (a9.mask ? ' •' + a9.mask : ''); });
      var byGid = {};
      (txR.data || []).forEach(function (t9) {
        if (!byGid[t9.transfer_group_id]) { byGid[t9.transfer_group_id] = { gid: t9.transfer_group_id, amount: Math.round((Number(t9.amount_abs) || 0) * 100) / 100, date: null, from_account: null, to_account: null, legs: 0 }; }
        var g9 = byGid[t9.transfer_group_id]; g9.legs++;
        var d9 = t9.posted_date || t9.date;
        if (!g9.date || d9 < g9.date) { g9.date = d9; }
        if (t9.direction === 'out') { g9.from_account = acName2[t9.account_id] || 'account'; }
        if (t9.direction === 'in') { g9.to_account = acName2[t9.account_id] || 'account'; }
      });
      var rowsR = Object.values(byGid).sort(function (a0, b0) { return (b0.date || '') < (a0.date || '') ? -1 : 1; });
      var sumR = 0; rowsR.forEach(function (r0) { sumR = Math.round((sumR + r0.amount) * 100) / 100; });
      return NextResponse.json({ ok: true, from: tf, to: tt, transfers: rowsR, count: rowsR.length, total: sumR, api_build_marker: API_BUILD_MARKER });
    }

    // ── bulk_classify (v55.83-PW, Max 10:51: "all accounting transactions
    //    from all bank accounts... do multiple category updates") — one
    //    category onto up to 500 EXPLICITLY-CHOSEN transactions. This is a
    //    deliberate human action, so it may overwrite earlier categories;
    //    it NEVER touches review/verified status or invoice matches, and it
    //    learns a rule per distinct merchant (capped) like single picks do. ──
    if (action === 'bulk_classify') {
      var idsB = (body.payload && body.payload.ids) || [];
      var clsB = body.payload && body.payload.classification;
      if (!Array.isArray(idsB) || idsB.length === 0) { return NextResponse.json({ ok: false, error: 'Pick at least one transaction.', api_build_marker: API_BUILD_MARKER }, { status: 400 }); }
      if (idsB.length > 500) { return NextResponse.json({ ok: false, error: 'Max 500 transactions per bulk update — narrow the selection.', api_build_marker: API_BUILD_MARKER }, { status: 400 }); }
      if (!clsB) { return NextResponse.json({ ok: false, error: 'Pick the category to apply.', api_build_marker: API_BUILD_MARKER }, { status: 400 }); }
      var catOkB = await db.from('expense_categories').select('key').eq('key', clsB).limit(1);
      if (!catOkB.error && (!catOkB.data || !catOkB.data.length)) { return NextResponse.json({ ok: false, error: 'Unknown category "' + clsB + '".', api_build_marker: API_BUILD_MARKER }, { status: 400 }); }
      var updB = await db.from('bank_transactions')
        .update({ classification: clsB, category_source: 'classification' })
        .in('id', idsB).select('id, direction, merchant_name, name');
      if (updB.error) { return NextResponse.json({ ok: false, error: updB.error.message, api_build_marker: API_BUILD_MARKER }, { status: 400 }); }
      var learnedB2 = 0; var seenKeys = {};
      var rowsB = updB.data || [];
      for (var bi = 0; bi < rowsB.length && learnedB2 < 50; bi++) {
        var tB = rowsB[bi];
        if (tB.direction !== 'out') { continue; }
        var textB = (tB.merchant_name || '') + ' ' + (tB.name || '');
        if (seenKeys[textB]) { continue; }
        seenKeys[textB] = true;
        var lr = await learnRule(db, textB, clsB, by);
        if (lr && (lr.learned || lr.updated)) { learnedB2++; }
      }
      // v55.83-PZ (Max): bulk categorization updates the WAVE side too —
      // the category's Wave account (explicit link, or exact-name match
      // saved onto the category) rides onto every selected transaction that
      // has NO Wave category yet and was never synced. Not compatible → Wave
      // simply stays empty. Existing Wave data is never overwritten.
      var waveSet = 0; var waveHow = null;
      try {
        var wlink = await waveAccountForCategory(db, clsB);
        if (wlink && wlink.wave_account_id) {
          waveHow = wlink.how;
          var wUpd = await db.from('bank_transactions')
            .update({ wave_account_id: wlink.wave_account_id, wave_account_name: wlink.wave_account_name, category_status: 'pending_wave_sync' })
            .in('id', idsB).is('wave_account_id', null).is('wave_transaction_id', null)
            .neq('category_status', 'synced')
            .select('id');
          if (!wUpd.error) { waveSet = (wUpd.data || []).length; }
        }
      } catch (eWv) { waveSet = 0; }
      await audit(db, by, 'bulk_categorized', 'bank_transactions', String(rowsB.length) + ' rows', { classification: clsB, rules_learned: learnedB2, wave_updated: waveSet }); // v55.83-QI
      return NextResponse.json({ ok: true, updated: rowsB.length, rules_learned: learnedB2, wave_updated: waveSet, wave_how: waveHow, api_build_marker: API_BUILD_MARKER });
    }

    // ── all_transactions: every account, one table — sort/filter server-side
    //    kept simple: the client gets the full window and sorts locally. ──
    if (action === 'all_transactions') {
      var fA = /^\d{4}-\d{2}-\d{2}$/.test(String((body.payload && body.payload.from) || '')) ? body.payload.from : '2026-01-01';
      var tA = /^\d{4}-\d{2}-\d{2}$/.test(String((body.payload && body.payload.to) || '')) ? body.payload.to : new Date().toISOString().substring(0, 10);
      // v55.83-QI (Max 12:35): moving the window beyond the default needs
      // accounting.change_dates (super admins always pass).
      var atLocked = false;
      var visDA = await assertPermission(db, body.user_id, 'accounting.change_dates', req);
      if (!visDA.ok) {
        var atTod = new Date().toISOString().substring(0, 10);
        if (fA < '2026-01-01') { fA = '2026-01-01'; atLocked = true; }
        if (tA > atTod) { tA = atTod; atLocked = true; }
      }
      var selColsA = 'id, date, posted_date, amount_abs, direction, account_id, name, merchant_name, classification, category_source, review_status, category_verified, matched_invoice_id, transfer_group_id, pending';
      var txA = await db.from('bank_transactions')
        .select(selColsA + ', third_party_payer, advance_flag') // v55.83-QB/QF — RTM + advance flags ride along
        .eq('wave_business_id', US_WAVE_BUSINESS_ID)
        .gte('date', fA).lte('date', tA)
        .order('date', { ascending: false }).limit(5000);
      if (txA.error && /advance_flag/.test(txA.error.message || '')) { // QF SQL not run yet
        txA = await db.from('bank_transactions').select(selColsA + ', third_party_payer')
          .eq('wave_business_id', US_WAVE_BUSINESS_ID)
          .gte('date', fA).lte('date', tA)
          .order('date', { ascending: false }).limit(5000);
      }
      if (txA.error && /third_party_payer/.test(txA.error.message || '')) { // QB SQL not run yet
        txA = await db.from('bank_transactions').select(selColsA)
          .eq('wave_business_id', US_WAVE_BUSINESS_ID)
          .gte('date', fA).lte('date', tA)
          .order('date', { ascending: false }).limit(5000);
      }
      if (txA.error) { return NextResponse.json({ ok: false, error: txA.error.message, api_build_marker: API_BUILD_MARKER }, { status: 400 }); }
      // v55.83-QF (Max 12:08: "should be signified as partial matched or
      // split full or split partial or unmatched") — how much of each txn is
      // applied, summed from BOTH payment ledgers (invoice payments for
      // deposits, bill payments for spending incl. RTM), fetched by the same
      // date window; fail-soft: on any error the chips fall back to the
      // simple matched flag.
      var appliedBy = {}; var legsBy = {};
      try {
        var payWinA = await db.from('accounting_invoice_payments')
          .select('bank_transaction_id, amount, voided, sync_status')
          .not('bank_transaction_id', 'is', null)
          .gte('payment_date', fA).lte('payment_date', tA).limit(20000);
        ((payWinA && payWinA.data) || []).forEach(function (p7) {
          var st7 = String(p7.sync_status || '').toLowerCase();
          if (p7.voided === true || st7 === 'void' || st7 === 'voided' || st7 === 'cancelled' || st7 === 'reversed' || st7 === 'deleted') { return; }
          appliedBy[p7.bank_transaction_id] = Math.round(((appliedBy[p7.bank_transaction_id] || 0) + (Number(p7.amount) || 0)) * 100) / 100;
          legsBy[p7.bank_transaction_id] = (legsBy[p7.bank_transaction_id] || 0) + 1;
        });
        var billWinA = await db.from('vendor_bill_payments')
          .select('bank_transaction_id, amount, voided')
          .not('bank_transaction_id', 'is', null)
          .gte('paid_date', fA).lte('paid_date', tA).limit(20000);
        ((billWinA && billWinA.data) || []).forEach(function (p8) {
          if (p8.voided === true) { return; }
          appliedBy[p8.bank_transaction_id] = Math.round(((appliedBy[p8.bank_transaction_id] || 0) + (Number(p8.amount) || 0)) * 100) / 100;
          legsBy[p8.bank_transaction_id] = (legsBy[p8.bank_transaction_id] || 0) + 1;
        });
      } catch (eApW) { appliedBy = {}; legsBy = {}; }
      var accA = await db.from('plaid_accounts').select('plaid_account_id, name, mask');
      var acMap = {};
      (accA.data || []).forEach(function (a6) { acMap[a6.plaid_account_id] = (a6.name || 'account') + (a6.mask ? ' •' + a6.mask : ''); });
      var outA = (txA.data || []).map(function (t7) {
        var wfull = [];
        if (t7.merchant_name) { wfull.push(t7.merchant_name); }
        if (t7.name && t7.name !== t7.merchant_name) { wfull.push(t7.name); }
        return { id: t7.id, date: t7.posted_date || t7.date, account: acMap[t7.account_id] || '(account)', who: t7.merchant_name || t7.name || '',
          who_full: wfull.join(' · ') || '(no description)',
          direction: t7.direction, amount: Math.round((Number(t7.amount_abs) || 0) * 100) / 100,
          classification: t7.classification, verified: t7.category_verified === true,
          matched: !!t7.matched_invoice_id, transfer: !!t7.transfer_group_id, pending: t7.pending === true, review_status: t7.review_status,
          third_party: t7.third_party_payer || null, advance: t7.advance_flag === true,
          applied: appliedBy[t7.id] || 0, applied_legs: legsBy[t7.id] || 0 };
      });
      return NextResponse.json({ ok: true, from: fA, to: tA, transactions: outA, count: outA.length, capped: (txA.data || []).length >= 5000, date_filters_locked: atLocked, api_build_marker: API_BUILD_MARKER });
    }

    // ── transfer_candidates: the other leg of a transfer (incl. credit cards) ──
    // Same amount (to the cent), opposite direction, different account, within
    // 7 days, settled, not already paired. Suggestions only — a human pairs.
    if (action === 'transfer_candidates') {
      var txq = await db.from('bank_transactions')
        .select('id, date, posted_date, amount_abs, direction, account_id, name, merchant_name, transfer_group_id')
        .eq('id', body.payload && body.payload.bank_transaction_id).maybeSingle();
      if (txq.error || !txq.data) { return NextResponse.json({ ok: false, error: 'Transaction not found.', api_build_marker: API_BUILD_MARKER }, { status: 404 }); }
      var t0 = txq.data;
      var d0 = t0.posted_date || t0.date;
      var lo = new Date(Date.parse(d0) - 7 * 86400000).toISOString().substring(0, 10);
      var hi = new Date(Date.parse(d0) + 7 * 86400000).toISOString().substring(0, 10);
      var cand = await db.from('bank_transactions')
        .select('id, date, posted_date, amount_abs, direction, account_id, name, merchant_name, classification, transfer_group_id')
        .eq('direction', t0.direction === 'out' ? 'in' : 'out')
        .gte('amount_abs', (Number(t0.amount_abs) || 0) - 0.005).lte('amount_abs', (Number(t0.amount_abs) || 0) + 0.005)
        .gte('date', lo).lte('date', hi)
        .neq('pending', true).is('transfer_group_id', null)
        .neq('account_id', t0.account_id || '').limit(20);
      if (cand.error) { return NextResponse.json({ ok: false, error: cand.error.message + (/transfer_group_id/.test(cand.error.message) ? ' — run sql/v55-83-PQ-category-wave-link.sql first.' : ''), api_build_marker: API_BUILD_MARKER }, { status: 400 }); }
      return NextResponse.json({ ok: true, txn: t0, candidates: cand.data || [], api_build_marker: API_BUILD_MARKER });
    }

    // ── pair_transfer: both legs become ONE transfer (classification=transfer,
    //    shared group id). Never touches rows already paired elsewhere. ──
    if (action === 'pair_transfer') {
      var idA = body.payload && body.payload.a; var idB = body.payload && body.payload.b;
      if (!idA || !idB || idA === idB) { return NextResponse.json({ ok: false, error: 'Two different transactions required.', api_build_marker: API_BUILD_MARKER }, { status: 400 }); }
      var both = await db.from('bank_transactions').select('id, direction, amount_abs, account_id, transfer_group_id').in('id', [idA, idB]);
      if (both.error || !both.data || both.data.length !== 2) { return NextResponse.json({ ok: false, error: 'Transactions not found.', api_build_marker: API_BUILD_MARKER }, { status: 404 }); }
      var A = both.data[0]; var B = both.data[1];
      if (A.transfer_group_id || B.transfer_group_id) { return NextResponse.json({ ok: false, error: 'One of them is already paired to another transfer.', api_build_marker: API_BUILD_MARKER }, { status: 409 }); }
      if (A.direction === B.direction) { return NextResponse.json({ ok: false, error: 'A transfer pair needs one money-out and one money-in leg.', api_build_marker: API_BUILD_MARKER }, { status: 400 }); }
      if (Math.abs((Number(A.amount_abs) || 0) - (Number(B.amount_abs) || 0)) > 0.005) { return NextResponse.json({ ok: false, error: 'Amounts differ — a transfer\'s two legs must match to the cent.', api_build_marker: API_BUILD_MARKER }, { status: 400 }); }
      var gid = (globalThis.crypto && globalThis.crypto.randomUUID) ? globalThis.crypto.randomUUID() : require('crypto').randomUUID();
      var updP = await db.from('bank_transactions')
        .update({ transfer_group_id: gid, classification: 'transfer', category_source: 'classification', updated_by: by })
        .in('id', [idA, idB]).is('transfer_group_id', null).select('id');
      if (updP.error) { return NextResponse.json({ ok: false, error: updP.error.message, api_build_marker: API_BUILD_MARKER }, { status: 400 }); }
      if (!updP.data || updP.data.length !== 2) { return NextResponse.json({ ok: false, error: 'Pairing raced another change — nothing saved, try again.', api_build_marker: API_BUILD_MARKER }, { status: 409 }); }
      await audit(db, by, 'transfer_paired', 'bank_transaction', idA + '+' + idB, { transfer_group_id: gid }); // v55.83-QI
      return NextResponse.json({ ok: true, transfer_group_id: gid, paired: [idA, idB], api_build_marker: API_BUILD_MARKER });
    }

    // ── unpair_transfer ──
    if (action === 'unpair_transfer') {
      var gid2 = body.payload && body.payload.transfer_group_id;
      if (!gid2) { return NextResponse.json({ ok: false, error: 'transfer_group_id required.', api_build_marker: API_BUILD_MARKER }, { status: 400 }); }
      var un = await db.from('bank_transactions').update({ transfer_group_id: null, updated_by: by }).eq('transfer_group_id', gid2).select('id');
      if (un.error) { return NextResponse.json({ ok: false, error: un.error.message, api_build_marker: API_BUILD_MARKER }, { status: 400 }); }
      await audit(db, by, 'transfer_unpaired', 'transfer_group', gid2, { legs: (un.data || []).length }); // v55.83-QI
      return NextResponse.json({ ok: true, unpaired: (un.data || []).length, api_build_marker: API_BUILD_MARKER });
    }

    return NextResponse.json({ ok: false, error: 'Unknown action "' + action + '".', api_build_marker: API_BUILD_MARKER }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e && e.message) || 'Server error', api_build_marker: API_BUILD_MARKER }, { status: 500 });
  }
}
