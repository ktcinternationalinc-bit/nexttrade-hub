// v55.83-WX — Bills → "Bill rules" (Max, 21 Nov 2026: "i need to be able to create rules for bills as well to place categories. even
// using a certain amount ... to always be partner fees ... and this will be used in the pnl breakdowns").
// Actions: list · save (create / change) · set_active (switch on / off; a rule is never deleted) · preview (what applying a rule to the
// bills on file would do) · apply (the previewed changes, re-checked here bill by bill). Reading needs Accounting Access + "Bills: view";
// changing needs "Bills: manage". The caller comes from the verified sign-in only. Every change is on the audit trail.
import { payrollBillScope, payrollFilteredDb, requestNamesPayroll, withPayrollLabel } from '../../../../lib/payroll-bills'; // v55.83-ZD
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifiedCaller } from '../../../../lib/verified-caller';
import { assertPermission } from '../../../../lib/server-permissions';
import { audit } from '../../../../lib/audit-server';
import { US_WAVE_BUSINESS_ID } from '../../../../lib/business-of';
import { cleanRule, previewRule, vendorKey } from '../../../../lib/bill-rules';
import { loadBillRules, loadCategoryMap, loadLinkedNameKeys } from '../../../../lib/bill-rules-server';
import { nameKey } from '../../../../lib/profitability';

var API_BUILD_MARKER = 'v55.83-WX-bill-rules';
var SQL_FILE = 'sql/v55-83-WX-bill-category-rules.sql';
function admin() { return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY); }
function bad(msg, status, extra) { return NextResponse.json(Object.assign({ ok: false, error: msg, api_build_marker: API_BUILD_MARKER }, extra || {}), { status: status || 400 }); }
async function fetchAll(buildQ) {
  var out = []; var from = 0;
  for (var pg = 0; pg < 50; pg++) {
    var r = await buildQ().range(from, from + 999);
    if (r.error) { throw new Error(r.error.message); }
    var rows = r.data || []; out = out.concat(rows);
    if (rows.length < 1000) { break; }
    from += 1000;
  }
  return out;
}
// a rule field compared as stored: amounts as numbers (12 = 12.00), everything else as text, blank = ''
function sameVal(k, v) { if (v === null || v === undefined || v === '') { return ''; } return /^amount_/.test(k) || k === 'priority' ? String(Number(v)) : String(v); }
var BILL_COLS ='id, vendor_name, bill_number, bill_date, total_amount, currency, wave_business_id, record_status, bill_type, release_number, other_reference, notes, category, category_source, category_rule_id, category_rule_version, paid_via, updated_at';

// everything a preview needs, for ONE rule: the active rules, the categories, the bills of that vendor, their lines and payments
async function previewFor(db, rule) {
  var all = await loadBillRules(db);
  if (all.error) { throw new Error('The rules could not be read (' + all.error + ').'); }
  var cats = await loadCategoryMap(db);
  var linked = await loadLinkedNameKeys(db);
  var vk = vendorKey(rule.vendor_match);
  var bills = (await fetchAll(function () { return db.from('vendor_bills').select(BILL_COLS).eq('record_status', 'active').order('id', { ascending: true }); }))
    .filter(function (b) { return vk && vendorKey(b.vendor_name).indexOf(vk) >= 0; });
  var ids = bills.map(function (b) { return b.id; });
  var linesOf = {}; var paidOf = {};
  for (var i = 0; i < ids.length; i += 200) {
    var chunk = ids.slice(i, i + 200);
    var lq = await db.from('vendor_bill_lines').select('bill_id, line_kind, description').in('bill_id', chunk);
    if (lq.error && !/vendor_bill_lines|does not exist|schema cache/i.test(lq.error.message || '')) { throw new Error('The bill lines could not be read (' + lq.error.message + ').'); }
    ((lq && lq.data) || []).forEach(function (l) { (linesOf[l.bill_id] = linesOf[l.bill_id] || []).push(l); });
    var pq = await db.from('vendor_bill_payments').select('bill_id, amount, voided').in('bill_id', chunk);
    if (pq.error) { throw new Error('The payments could not be read (' + pq.error.message + ').'); }
    (pq.data || []).forEach(function (p) { if (p.voided !== true) { paidOf[p.bill_id] = (paidOf[p.bill_id] || 0) + (Number(p.amount) || 0); } });
  }
  var rules = all.rules.filter(function (r) { return r.active !== false; });
  if (!rules.some(function (r) { return String(r.id) === String(rule.id); })) { rules = rules.concat([rule]); }
  var rows = previewRule(rule, bills, { rules: rules, catByKey: cats, linesOf: linesOf, linkedNameKeys: linked, nameKeyFn: nameKey, paidOf: paidOf });
  var billById = {}; bills.forEach(function (b) { billById[b.id] = b; });
  return { rows: rows, billById: billById, cats: cats };
}

async function postZD(req) {
  var db = admin();
  try {
    var body = await req.json();
    var who = await verifiedCaller(req, body, createClient);
    if (who.error) { return bad(who.error, who.status || 401); }
    var userId = who.userId;
    // v55.83-ZD — payroll bills: SUPER ADMIN ONLY. Who is calling + the payroll list, read once (fails closed); for anyone else a request
    // naming a payroll bill / wire package is "not found", and every read below leaves payroll out (so every total excludes it).
    var payZD = await payrollBillScope(db, userId); if (payZD.error) { return Response.json({ ok: false, error: payZD.error }, { status: payZD.status }); }
    if (requestNamesPayroll(payZD, body)) { return Response.json({ ok: false, error: 'Not found.' }, { status: 404 }); }
    db = payrollFilteredDb(db, payZD); try { req.__payZD = payZD; } catch (eZD) { /* read-only request */ }
    var p1 = await assertPermission(db, userId, 'accounting.view', req);
    if (!p1 || p1.ok !== true) { return bad('This needs "Accounting Access" (P1).', 403); }
    var action = String(body.action || 'list');
    var canManage = await assertPermission(db, userId, 'bills.manage', req);
    canManage = !!(canManage && canManage.ok === true);
    if (!canManage) {
      var canView = await assertPermission(db, userId, 'bills.view', req);
      if (!canView || canView.ok !== true) { return bad('This needs the "Bills: view" permission.', 403); }
      if (action !== 'list' && action !== 'preview') { return bad('Changing bill rules needs the "Bills: manage" permission.', 403); }
    }

    if (action === 'list') {
      var lr = await loadBillRules(db, { all: true });
      if (lr.error) { return bad('The rules could not be read (' + lr.error + ').', 503); }
      var cm = await loadCategoryMap(db);
      var cl = Object.keys(cm).map(function (k) { return cm[k]; }).filter(function (c) { return c.active !== false; }).map(function (c) { return { key: c.key, label: c.label || c.key, kind: c.kind || null }; });
      cl.sort(function (a, b) { return String(a.label).localeCompare(String(b.label)); });
      return NextResponse.json({ ok: true, ready: lr.ready, sql_file: lr.ready ? undefined : SQL_FILE, rules: lr.rules, categories: cl, can_manage: canManage, api_build_marker: API_BUILD_MARKER });
    }

    var ready = await loadBillRules(db, { all: true });
    if (ready.error) { return bad('The rules could not be read (' + ready.error + ').', 503); }
    if (!ready.ready) { return bad('Bill rules need a one-time database step (' + SQL_FILE + ') — nothing was changed.', 409, { needs_sql: true }); }
    function ruleById(id) { return ready.rules.filter(function (r) { return String(r.id) === String(id); })[0] || null; }

    if (action === 'save') {
      var cmS = await loadCategoryMap(db);
      var cr = cleanRule(body.rule || {}, Object.keys(cmS));
      if (!cr.ok) { return bad(cr.errors.join(' '), 400); }
      var nowS = new Date().toISOString();
      var input = body.rule || {};
      if (input.id) {
        var cur = ruleById(input.id);
        if (!cur) { return bad('That rule was not found.', 404); }
        var matchChanged = ['vendor_match', 'amount_exact', 'amount_min', 'amount_max', 'words', 'currency', 'category', 'priority'].some(function (k) { return sameVal(k, cur[k]) !== sameVal(k, cr.rule[k]); });
        var patch = Object.assign({}, cr.rule, { updated_by: userId, updated_at: nowS, version: (Number(cur.version) || 1) + (matchChanged ? 1 : 0) });
        var up = await db.from('bill_category_rules').update(patch).eq('id', cur.id).eq('version', cur.version).select('*').maybeSingle();
        if (up.error) { throw new Error(up.error.message); }
        if (!up.data) { return bad('Someone else changed this rule a moment ago — open it again. Nothing was changed.', 409); }
        await audit(db, userId, 'bill_rule_updated', 'bill_category_rule', cur.id, { before: cur, after: up.data });
        return NextResponse.json({ ok: true, rule: up.data, api_build_marker: API_BUILD_MARKER });
      }
      var row = Object.assign({}, cr.rule, { wave_business_id: US_WAVE_BUSINESS_ID, version: 1, created_by: userId, updated_by: userId, created_at: nowS, updated_at: nowS });
      var ins = await db.from('bill_category_rules').insert(row).select('*').maybeSingle();
      if (ins.error) { throw new Error(ins.error.message); }
      await audit(db, userId, 'bill_rule_created', 'bill_category_rule', ins.data && ins.data.id, { after: ins.data });
      return NextResponse.json({ ok: true, rule: ins.data, api_build_marker: API_BUILD_MARKER });
    }

    if (action === 'set_active') {
      var ra = ruleById(body.id);
      if (!ra) { return bad('That rule was not found.', 404); }
      var on = body.active === true;
      var ua = await db.from('bill_category_rules').update({ active: on, updated_by: userId, updated_at: new Date().toISOString() }).eq('id', ra.id).select('*').maybeSingle();
      if (ua.error) { throw new Error(ua.error.message); }
      await audit(db, userId, on ? 'bill_rule_switched_on' : 'bill_rule_switched_off', 'bill_category_rule', ra.id, { name: ra.name, category: ra.category });
      return NextResponse.json({ ok: true, rule: ua.data, note: on ? undefined : 'Switched off. Bills it already categorised keep their category.', api_build_marker: API_BUILD_MARKER });
    }

    if (action === 'preview') {
      var rp = ruleById(body.id);
      if (!rp) { return bad('That rule was not found.', 404); }
      if (rp.active === false) { return bad('This rule is switched off — switch it on to preview or apply it.', 409); }
      var pv = await previewFor(db, rp);
      var counts = {}; pv.rows.forEach(function (r) { counts[r.status] = (counts[r.status] || 0) + 1; });
      return NextResponse.json({ ok: true, rule: rp, rows: pv.rows, counts: counts, api_build_marker: API_BUILD_MARKER });
    }

    if (action === 'apply') {
      var rA = ruleById(body.id);
      if (!rA) { return bad('That rule was not found.', 404); }
      if (rA.active === false) { return bad('This rule is switched off — nothing was changed.', 409); }
      var want = Array.isArray(body.bill_ids) ? body.bill_ids.map(String) : [];
      if (!want.length) { return bad('Tick the bills to change.', 400); }
      var pvA = await previewFor(db, rA);
      var statusOf = {}; pvA.rows.forEach(function (r) { statusOf[String(r.id)] = r; });
      var applied = []; var skipped = [];
      for (var i = 0; i < want.length; i++) {
        var id = want[i]; var pr = statusOf[id]; var b = pvA.billById[id];
        if (!pr || !b) { skipped.push({ id: id, why: 'not a bill this rule fits any more' }); continue; }
        if (pr.status !== 'will_set') { skipped.push({ id: id, why: pr.why || pr.status }); continue; }
        var q = db.from('vendor_bills').update({ category: rA.category, category_source: 'rule', category_rule_id: rA.id, category_rule_version: Number(rA.version) || 1, updated_at: new Date().toISOString() })
          .eq('id', id).eq('record_status', 'active');
        q = b.category === null || b.category === undefined ? q.is('category', null) : q.eq('category', b.category);
        q = b.category_source === null || b.category_source === undefined ? q.is('category_source', null) : q.eq('category_source', b.category_source);
        var u = await q.select('id').maybeSingle();
        if (u.error) { throw new Error(u.error.message); }
        if (!u.data) { skipped.push({ id: id, why: 'it changed while you were looking — not changed' }); continue; }
        await audit(db, userId, 'bill_category_rule_applied', 'vendor_bill', id, {
          rule: { id: rA.id, name: rA.name, version: Number(rA.version) || 1 },
          before: { category: b.category || null, category_source: b.category_source || null, category_rule_id: b.category_rule_id || null, category_rule_version: b.category_rule_version || null },
          after: { category: rA.category, category_source: 'rule', category_rule_id: rA.id, category_rule_version: Number(rA.version) || 1 },
          paid: pr.paid || 0, paid_via: b.paid_via || null, bill: { vendor: b.vendor_name, number: b.bill_number, date: b.bill_date, amount: b.total_amount } });
        applied.push({ id: id, paid: pr.paid || 0 });
      }
      var paidChanged = applied.filter(function (a) { return a.paid > 0; }).length;
      return NextResponse.json({ ok: true, applied: applied.length, skipped: skipped, paid_changed: paidChanged,
        note: paidChanged ? paidChanged + ' of them already had money paid — the P&L of the period they were paid in can change.' : undefined, api_build_marker: API_BUILD_MARKER });
    }

    return bad('Unknown action.', 400);
  } catch (e) {
    if (/HUB_GUARD/.test(String((e && e.message) || ''))) { return bad(String(e.message).replace(/^[\s\S]*HUB_GUARD:\s*/, '') + ' Nothing was changed.', 409); }
    return bad('Bill rules request failed (' + ((e && e.message) || 'error') + ').', 500);
  }
}

// v55.83-ZD — the answer says "excluding payroll" to a non-super-admin whenever payroll bills exist (they are left out of it)
export async function POST(req) { return withPayrollLabel(req, await postZD(req)); }
