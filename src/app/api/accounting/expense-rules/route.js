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
import { applyExpenseRules } from '../../../../lib/expense-rules-server';
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
      var cats = await db.from('expense_categories').select('id, key, label, active, sort').order('sort').order('label');
      if (cats.error) { return NextResponse.json({ ok: false, error: cats.error.message + ' — run sql/v55-83-PI-expense-categories-rules.sql first.', needs_sql: true, api_build_marker: API_BUILD_MARKER }, { status: 400 }); }
      var rules = await db.from('us_expense_rules').select('id, match_text, classification, auto_apply, active, source, hit_count, last_hit_at, updated_at').order('updated_at', { ascending: false }).limit(1000);
      return NextResponse.json({ ok: true, categories: cats.data || [], rules: (rules.data || []), api_build_marker: API_BUILD_MARKER });
    }

    // ── save_category: create (or relabel) a category ──
    if (action === 'save_category') {
      var label = String((body.payload && body.payload.label) || '').trim();
      if (label.length < 2) { return NextResponse.json({ ok: false, error: 'Category name must be at least 2 characters.', api_build_marker: API_BUILD_MARKER }, { status: 400 }); }
      if (body.payload && body.payload.id) {
        var updc = await db.from('expense_categories').update({ label: label, updated_at: new Date().toISOString() }).eq('id', body.payload.id).select();
        if (updc.error) { return NextResponse.json({ ok: false, error: updc.error.message, api_build_marker: API_BUILD_MARKER }, { status: 400 }); }
        return NextResponse.json({ ok: true, category: updc.data && updc.data[0], api_build_marker: API_BUILD_MARKER });
      }
      var key = slugify(label);
      if (key.length < 2) { return NextResponse.json({ ok: false, error: 'Category name needs letters or numbers.', api_build_marker: API_BUILD_MARKER }, { status: 400 }); }
      var insc = await db.from('expense_categories').insert({ key: key, label: label, created_by: by }).select();
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
        .select('id, date, posted_date, amount_abs, name, merchant_name, classification, category_source, review_status, category_verified, category_verified_at, pending')
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
      return NextResponse.json({ ok: true, row: vr.data && vr.data[0], api_build_marker: API_BUILD_MARKER });
    }

    return NextResponse.json({ ok: false, error: 'Unknown action "' + action + '".', api_build_marker: API_BUILD_MARKER }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e && e.message) || 'Server error', api_build_marker: API_BUILD_MARKER }, { status: 500 });
  }
}
