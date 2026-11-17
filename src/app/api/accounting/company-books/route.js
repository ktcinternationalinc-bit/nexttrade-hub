// /api/accounting/company-books — v55.83-TW. NEXTRADE and RTM, each its own books (Max, Nov 17 2026).
// Every action names the company ('nextrade' | 'rtm'); a request without one is refused — never treated as KTC.
// Everything is scoped to that company's bank lines (bank_transactions.wave_business_id = NEXTRADE_BOOKS / RTM_BOOKS):
//   accounts · lines · set_category · categories · save_category · category_active · rules · save_rule · rule_active ·
//   apply_rules · totals · mapping · save_mapping (Nextrade) · nextrade_bills (KTC Bills → 🟦 Nextrade bills).
// Categorizing a Nextrade money-out line as an expense makes / updates / voids its KTC bill (src/lib/nextrade-bills-server.js)
// BEFORE the category is saved, so the two never disagree; when the KTC side refuses, the category is not saved.
// Every action acts for the verified signed-in person (bearer token). Reads need the company's view permission, writes
// its manage permission (super admin passes). Nothing is ever deleted. SWC-safe: var + string concatenation only.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { assertPermission } from '../../../../lib/server-permissions';
import { verifiedCaller } from '../../../../lib/verified-caller';
import { audit } from '../../../../lib/audit-server';
import { companyByKey, COMPANY_KINDS, categoryKey, bestCompanyRule, companyTotals, normMatch, NEXTRADE_COMPANY_ID } from '../../../../lib/companies';
import { categorizeLine, partyName } from '../../../../lib/nextrade-bills-server'; // v55.83-TW (Codex P1-2): one database function, all or nothing
import { privateScope, dropPrivate, isPrivateRow } from '../../../../lib/private-accounts-server'; // v55.83-TP private bank accounts — respected here too

var API_BUILD_MARKER = 'v55.83-TW-company-books';
export const maxDuration = 60;
var SQL_MISSING = 'Nextrade and RTM books need one database update first: run sql/v55-83-TW-company-books.sql in Supabase (SQL Editor).';
var LINE_COLS = 'id, date, posted_date, amount_abs, direction, account_id, name, merchant_name, pending, review_status, wave_business_id, company_category, company_category_source, company_category_at';

function admin() { return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } }); }
function missingRel(e) { return /does not exist|schema cache|Could not find the table|company_category/i.test(String((e && e.message) || '')); }
function isDate(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s); }
function fail(msg, st) { return NextResponse.json({ ok: false, error: msg }, { status: st || 400 }); }
function readFail(what, e) { return NextResponse.json({ ok: false, error: missingRel(e) ? SQL_MISSING : 'Could not read ' + what + ' (' + ((e && e.message) || 'error') + ') — nothing changed.' }, { status: missingRel(e) ? 409 : 503 }); }

async function pageLines(db, companyId, from, to) {
  var out = [];
  for (var pg = 0; pg < 30; pg++) {
    var r = await db.from('bank_transactions').select(LINE_COLS).eq('wave_business_id', companyId)
      .or('review_status.is.null,review_status.neq.duplicate').gte('date', from).lte('date', to)
      .order('date', { ascending: false }).order('id', { ascending: true }).range(pg * 1000, pg * 1000 + 999);
    if (r.error) { return { error: r.error }; }
    out = out.concat(r.data || []);
    if (!r.data || r.data.length < 1000) { return { data: out }; }
  }
  return { data: out, capped: true };
}
async function loadCats(db, companyId) {
  var r = await db.from('company_categories').select('id, key, label, kind, is_payroll, active, sort').eq('company_id', companyId).order('sort').order('label');
  return r;
}

export async function POST(req) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) { return fail('Server key missing.', 500); }
  var db = admin();
  try {
    var body = await req.json();
    var action = String(body.action || '');
    var who = await verifiedCaller(req, body, createClient);
    if (who.error) { return fail(who.error, who.status || 401); }
    var userId = who.userId;
    // v55.83-TP (live) — private bank accounts: hidden unless super admin or 'bank.view_private'; fails closed
    var scope = await privateScope(db, userId);
    if (scope.error) { return fail(scope.error + ' — nothing shown.', 503); }

    // KTC Bills → 🟦 Nextrade bills: a KTC screen, so it needs Bills: View / Manage (not the Nextrade permission)
    if (action === 'nextrade_bills') {
      var gb = await assertPermission(db, userId, 'bills.manage', req);
      if (!gb || gb.ok !== true) { gb = await assertPermission(db, userId, 'bills.view', req); }
      if (!gb || gb.ok !== true) { return fail('This needs the "Bills: View" permission.', 403); }
      var lk = await db.from('company_bill_links').select('id, source_bank_transaction_id, bill_id, mode, status, category_key, set_paid_via, message, updated_at').eq('company_id', NEXTRADE_COMPANY_ID).order('updated_at', { ascending: false }).limit(2000);
      if (lk.error) { return missingRel(lk.error) ? NextResponse.json({ ok: true, rows: [], sql_missing: SQL_MISSING }) : readFail('the Nextrade bills', lk.error); }
      var links = (lk.data || []).filter(function (l) { return !!l.bill_id; });
      var billIds = links.map(function (l) { return l.bill_id; }); var lineIds = links.map(function (l) { return l.source_bank_transaction_id; });
      var bills = {}; var lines = {}; var paid = {};
      for (var bi = 0; bi < billIds.length; bi += 200) {
        var chunk = billIds.slice(bi, bi + 200); var lchunk = lineIds.slice(bi, bi + 200);
        var bq = await db.from('vendor_bills').select('id, vendor_name, bill_number, bill_date, due_date, total_amount, category, record_status, paid_via').in('id', chunk);
        var lq = await db.from('bank_transactions').select('id, date, name, merchant_name, amount_abs, account_id').in('id', lchunk);
        var pq = await db.from('vendor_bill_payments').select('bill_id, amount, voided').in('bill_id', chunk);
        if (bq.error || lq.error || pq.error) { return readFail('the Nextrade bills', bq.error || lq.error || pq.error); }
        (bq.data || []).forEach(function (b) { bills[b.id] = b; });
        (lq.data || []).forEach(function (l) { lines[l.id] = l; });
        (pq.data || []).forEach(function (p) { if (p.voided !== true) { paid[p.bill_id] = (paid[p.bill_id] || 0) + (Number(p.amount) || 0); } });
      }
      var rowsNb = links.map(function (l) { var ln0 = lines[l.source_bank_transaction_id] || null; if (ln0 && isPrivateRow(ln0, scope)) { ln0 = { date: ln0.date, name: '(private account)' }; } return { link: l, bill: bills[l.bill_id] || null, line: ln0, paid: Math.round((paid[l.bill_id] || 0) * 100) / 100 }; });
      var gTotN = await assertPermission(db, userId, 'accounting.view_totals', req); // the 'still owed' sum is a sensitive total (Codex P1-1)
      return NextResponse.json({ ok: true, rows: rowsNb, can_totals: !!(gTotN && gTotN.ok === true), api_build_marker: API_BUILD_MARKER });
    }

    var comp = companyByKey(body.company);
    if (!comp) { return fail('Say which company: Nextrade or RTM.'); }
    var WRITES = { set_category: 1, save_category: 1, category_active: 1, save_rule: 1, rule_active: 1, apply_rules: 1, save_mapping: 1 };
    var g = await assertPermission(db, userId, WRITES[action] ? comp.managePerm : comp.viewPerm, req);
    if ((!g || g.ok !== true) && !WRITES[action]) { g = await assertPermission(db, userId, comp.managePerm, req); }
    if (!g || g.ok !== true) { return fail('This needs the "' + comp.label + (WRITES[action] ? ': Manage' : ': View') + '" permission — ask the super admin to grant it in Settings.', 403); }
    var cid = comp.id;

    if (action === 'accounts') {
      var ac = await db.from('plaid_accounts').select('plaid_account_id, name, official_name, mask, type, subtype, connection_id, current_balance, updated_at').eq('wave_business_id', cid);
      if (ac.error) { return readFail('the accounts', ac.error); }
      var connIds = (ac.data || []).map(function (a) { return a.connection_id; }).filter(Boolean);
      var conns = {};
      if (connIds.length) { var cq = await db.from('bank_connections').select('id, institution_name, status').in('id', connIds); if (cq.error) { return readFail('the connections', cq.error); } (cq.data || []).forEach(function (c) { conns[c.id] = c; }); }
      ac.data = dropPrivate(ac.data || [], scope, 'plaid_account_id');
      // v55.83-TW (Codex P1-1) — account balances are a sensitive number: only with 'Bank: View Account Balances'
      var gBal = await assertPermission(db, userId, 'bank_balances.view', req);
      if (!gBal || gBal.ok !== true) { ac.data = ac.data.map(function (a) { var o = Object.assign({}, a); delete o.current_balance; return o; }); }
      return NextResponse.json({ ok: true, accounts: (ac.data || []).map(function (a) { var c = conns[a.connection_id] || {}; return Object.assign({}, a, { institution: c.institution_name || null, connection_status: c.status || null, is_card: a.type === 'credit' }); }) });
    }

    if (action === 'categories') {
      var cr = await loadCats(db, cid);
      if (cr.error) { return missingRel(cr.error) ? NextResponse.json({ ok: true, categories: [], kinds: COMPANY_KINDS, sql_missing: SQL_MISSING }) : readFail('the categories', cr.error); }
      return NextResponse.json({ ok: true, categories: cr.data || [], kinds: COMPANY_KINDS });
    }

    if (action === 'save_category') {
      var p = body.category || {};
      var label = String(p.label || '').trim().substring(0, 80);
      if (label.length < 2) { return fail('Type the category name.'); }
      var kind = String(p.kind || 'expense');
      if (!COMPANY_KINDS[kind]) { return fail('Pick what kind of category it is.'); }
      var row = { label: label, kind: kind, is_payroll: p.is_payroll === true && kind === 'expense', sort: Math.max(0, Math.min(999, Number(p.sort) || 100)), updated_by: userId, updated_at: new Date().toISOString() };
      if (p.id) {
        var cu = await db.from('company_categories').select('id, key, kind, is_payroll, label').eq('id', p.id).eq('company_id', cid).maybeSingle();
        if (cu.error) { return readFail('the category', cu.error); }
        if (!cu.data) { return fail('Category not found in ' + comp.label + '.', 404); }
        var u = await db.from('company_categories').update(row).eq('id', p.id).eq('company_id', cid).select('id');
        if (u.error) { return fail('Not saved (' + u.error.message + ').', 500); }
        await audit(db, userId, 'company_category_edited', 'company_category', p.id, { company: comp.label, from: { label: cu.data.label, kind: cu.data.kind, is_payroll: cu.data.is_payroll }, to: { label: row.label, kind: row.kind, is_payroll: row.is_payroll } });
        // lines already in this category keep it; their KTC bills follow the new kind the next time each is categorized
        return NextResponse.json({ ok: true, id: p.id, note: (cu.data.kind !== row.kind || cu.data.is_payroll !== row.is_payroll) && comp.key === 'nextrade' ? 'Lines already in this category keep their KTC bills as they are; re-pick the category on a line to update its bill.' : undefined });
      }
      var key = categoryKey(label);
      if (!key) { return fail('Use letters or numbers in the name.'); }
      row.key = key; row.company_id = cid; row.created_by = userId; row.active = true;
      var ci = await db.from('company_categories').insert(row).select('id').maybeSingle();
      if (ci.error) { return fail(ci.error.code === '23505' ? comp.label + ' already has a category called that.' : missingRel(ci.error) ? SQL_MISSING : 'Not saved (' + ci.error.message + ').', ci.error.code === '23505' ? 409 : 500); }
      await audit(db, userId, 'company_category_created', 'company_category', ci.data.id, { company: comp.label, key: key, label: label, kind: kind, is_payroll: row.is_payroll });
      return NextResponse.json({ ok: true, id: ci.data.id, key: key });
    }

    if (action === 'category_active') {
      var ca = await db.from('company_categories').update({ active: body.active === true, updated_by: userId, updated_at: new Date().toISOString() }).eq('id', body.id).eq('company_id', cid).select('id');
      if (ca.error) { return fail('Not saved (' + ca.error.message + ').', 500); }
      if (!ca.data || !ca.data.length) { return fail('Category not found in ' + comp.label + '.', 404); }
      await audit(db, userId, body.active === true ? 'company_category_on' : 'company_category_off', 'company_category', body.id, { company: comp.label });
      return NextResponse.json({ ok: true });
    }

    if (action === 'rules') {
      var rr = await db.from('company_rules').select('id, match_text, category_key, direction, active, hit_count, updated_at').eq('company_id', cid).order('updated_at', { ascending: false }).limit(2000);
      if (rr.error) { return missingRel(rr.error) ? NextResponse.json({ ok: true, rules: [], sql_missing: SQL_MISSING }) : readFail('the rules', rr.error); }
      return NextResponse.json({ ok: true, rules: rr.data || [] });
    }

    if (action === 'save_rule' || action === 'rule_active') {
      if (action === 'rule_active') {
        var ra = await db.from('company_rules').update({ active: body.active === true, updated_by: userId, updated_at: new Date().toISOString() }).eq('id', body.id).eq('company_id', cid).select('id');
        if (ra.error) { return fail('Not saved (' + ra.error.message + ').', 500); }
        if (!ra.data || !ra.data.length) { return fail('Rule not found in ' + comp.label + '.', 404); }
        await audit(db, userId, body.active === true ? 'company_rule_on' : 'company_rule_off', 'company_rule', body.id, { company: comp.label });
        return NextResponse.json({ ok: true });
      }
      var rp = body.rule || {};
      var mt = normMatch(rp.match_text);
      if (mt.length < 3) { return fail('Type at least 3 letters the description contains.'); }
      var dir = rp.direction === 'in' || rp.direction === 'out' ? rp.direction : 'any';
      var catsR = await loadCats(db, cid);
      if (catsR.error) { return readFail('the categories', catsR.error); }
      var okCat = (catsR.data || []).filter(function (c) { return c.key === rp.category_key && c.active; })[0];
      if (!okCat) { return fail('Pick one of ' + comp.label + '’s categories.'); }
      var rrow = { match_text: mt, category_key: okCat.key, direction: dir, active: true, updated_by: userId, updated_at: new Date().toISOString() };
      if (rp.id) {
        var ru = await db.from('company_rules').update(rrow).eq('id', rp.id).eq('company_id', cid).select('id');
        if (ru.error) { return fail(ru.error.code === '23505' ? 'There is already a rule for that text.' : 'Not saved (' + ru.error.message + ').', 409); }
        if (!ru.data || !ru.data.length) { return fail('Rule not found in ' + comp.label + '.', 404); }
        await audit(db, userId, 'company_rule_edited', 'company_rule', rp.id, { company: comp.label, match_text: mt, category: okCat.key, direction: dir });
        return NextResponse.json({ ok: true, id: rp.id });
      }
      rrow.company_id = cid; rrow.created_by = userId;
      var rins = await db.from('company_rules').insert(rrow).select('id').maybeSingle();
      if (rins.error) { return fail(rins.error.code === '23505' ? 'There is already a rule for that text — edit it instead.' : 'Not saved (' + rins.error.message + ').', 409); }
      await audit(db, userId, 'company_rule_created', 'company_rule', rins.data.id, { company: comp.label, match_text: mt, category: okCat.key, direction: dir });
      return NextResponse.json({ ok: true, id: rins.data.id });
    }

    var from = isDate(body.from) ? body.from : '2026-01-01';
    var to = isDate(body.to) ? body.to : new Date().toISOString().substring(0, 10);

    if (action === 'totals') { // v55.83-TW (Codex P1-1) — month totals (money in / out / transfers) need the sensitive 'Bank & Financial Summary'
      var gTot = await assertPermission(db, userId, 'accounting.view_totals', req);
      if (!gTot || gTot.ok !== true) { return fail('Totals need the "P2 · Bank & Financial Summary" permission — ask the super admin.', 403); }
    }
    if (action === 'lines' || action === 'totals') {
      var catsL = await loadCats(db, cid);
      if (catsL.error) { return missingRel(catsL.error) ? NextResponse.json({ ok: true, lines: [], categories: [], sql_missing: SQL_MISSING }) : readFail('the categories', catsL.error); }
      var pl = await pageLines(db, cid, from, to);
      if (pl.error) { return readFail('the bank lines', pl.error); }
      pl.data = dropPrivate(pl.data, scope);
      var byKey = {}; (catsL.data || []).forEach(function (c) { byKey[c.key] = c; });
      // payroll shows as "Warehouse staff" — no names (Max)
      var linesOut = (pl.data || []).map(function (l) { var c = byKey[l.company_category]; return (c && c.is_payroll) ? Object.assign({}, l, { name: 'Warehouse staff', merchant_name: null }) : l; });
      if (action === 'totals') { return NextResponse.json({ ok: true, totals: companyTotals(linesOut, catsL.data || []), from: from, to: to, capped: !!pl.capped }); }
      var links = {};
      if (comp.key === 'nextrade' && linesOut.length) {
        var lnk = await db.from('company_bill_links').select('source_bank_transaction_id, bill_id, mode, status').eq('company_id', cid).eq('status', 'active').limit(20000);
        if (!lnk.error) { (lnk.data || []).forEach(function (x) { links[x.source_bank_transaction_id] = x; }); }
      }
      var acR = await db.from('plaid_accounts').select('plaid_account_id, name, mask, type').eq('wave_business_id', cid);
      var accts = {}; ((acR && acR.data) || []).forEach(function (a) { accts[a.plaid_account_id] = a; });
      return NextResponse.json({ ok: true, lines: linesOut.map(function (l) { var a = accts[l.account_id] || {}; return Object.assign({}, l, { account_label: (a.name || 'account') + (a.mask ? ' ••' + a.mask : ''), is_card: a.type === 'credit', ktc_bill: links[l.id] || null }); }), categories: catsL.data || [], capped: !!pl.capped });
    }

    // the KTC side needs: the party name and the Nextrade → KTC category mapping
    async function nextradeCtx() {
      var mp = await db.from('company_category_map').select('category_key, ktc_category').eq('company_id', NEXTRADE_COMPANY_ID);
      if (mp.error) { return { error: mp.error }; }
      var map = {}; (mp.data || []).forEach(function (m) { map[m.category_key] = m.ktc_category; });
      return { map: map, party: await partyName(db) };
    }
    async function categorize(line, cat, source, nctx) {
      var label = null;
      if (comp.key === 'nextrade') {
        var acc = await db.from('plaid_accounts').select('name, mask').eq('plaid_account_id', line.account_id).maybeSingle();
        if (acc.error) { return { id: line.id, ok: false, error: 'Could not read the account (' + acc.error.message + ') — nothing changed.' }; }
        label = acc.data ? (acc.data.name || '') + (acc.data.mask ? ' ••' + acc.data.mask : '') : null;
      }
      var res = await categorizeLine(db, line, cat, { actorId: userId, source: source, ktcCategory: cat && nctx ? nctx.map[cat.key] || null : null, party: nctx ? nctx.party : null, accountLabel: label });
      if (!res.ok) { return { id: line.id, ok: false, error: res.error }; }
      return { id: line.id, ok: true, ktc: comp.key === 'nextrade' ? res : undefined };
    }

    var WRITES_CAT = { set_category: 1, apply_rules: 1 };
    if (WRITES_CAT[action]) { var instC = await db.rpc('hub_company_books_installed'); if (instC.error || instC.data !== true) { return fail(SQL_MISSING, 409); } }
    if (action === 'set_category') {
      var ids = Array.isArray(body.ids) ? body.ids.slice(0, 200) : [];
      if (!ids.length) { return fail('Pick the line(s).'); }
      var catsS = await loadCats(db, cid);
      if (catsS.error) { return readFail('the categories', catsS.error); }
      var catS = null;
      if (body.category_key) {
        catS = (catsS.data || []).filter(function (c) { return c.key === body.category_key; })[0] || null;
        if (!catS || !catS.active) { return fail('Pick one of ' + comp.label + '’s categories.'); }
      }
      var lr = await db.from('bank_transactions').select(LINE_COLS).in('id', ids);
      if (lr.error) { return readFail('the lines', lr.error); }
      var wrong = (lr.data || []).filter(function (l) { return l.wave_business_id !== cid || isPrivateRow(l, scope); });
      if (wrong.length || (lr.data || []).length !== ids.length) { return fail('Some of those lines are not ' + comp.label + ' lines — nothing was changed.', 409); }
      var nctx = null;
      if (comp.key === 'nextrade') { nctx = await nextradeCtx(); if (nctx.error) { return readFail('the category mapping', nctx.error); } }
      var results = [];
      for (var i = 0; i < lr.data.length; i++) { results.push(await categorize(lr.data[i], catS, 'manual', nctx)); }
      var bad = results.filter(function (r) { return !r.ok; });
      return NextResponse.json({ ok: bad.length === 0, results: results, saved: results.length - bad.length, error: bad.length ? bad.length + ' line(s) not changed: ' + bad.map(function (b) { return b.error; }).join(' · ') : undefined });
    }

    if (action === 'apply_rules') {
      var catsA = await loadCats(db, cid); var rulesA = await db.from('company_rules').select('id, match_text, category_key, direction, active, hit_count').eq('company_id', cid).eq('active', true);
      if (catsA.error || rulesA.error) { return readFail('the rules', catsA.error || rulesA.error); }
      var byKeyA = {}; (catsA.data || []).forEach(function (c) { if (c.active) { byKeyA[c.key] = c; } });
      var plA = await pageLines(db, cid, from, to);
      if (plA.error) { return readFail('the bank lines', plA.error); }
      var nctxA = null;
      if (comp.key === 'nextrade') { nctxA = await nextradeCtx(); if (nctxA.error) { return readFail('the category mapping', nctxA.error); } }
      var done = 0; var problems = []; var hits = {};
      var todo = dropPrivate(plA.data, scope).filter(function (l) { return !l.company_category && l.pending !== true; });
      for (var j = 0; j < todo.length && j < 500; j++) {
        var ln = todo[j];
        var rules = (rulesA.data || []).filter(function (r) { return r.direction === 'any' || r.direction === ln.direction; });
        var rule = bestCompanyRule(rules, String(ln.merchant_name || '') + ' ' + String(ln.name || ''));
        if (!rule || !byKeyA[rule.category_key]) { continue; }
        var res = await categorize(ln, byKeyA[rule.category_key], 'rule', nctxA);
        if (res.ok) { done++; hits[rule.id] = (hits[rule.id] || 0) + 1; } else { problems.push(res.error); }
      }
      var hitIds = Object.keys(hits);
      for (var h = 0; h < hitIds.length; h++) {
        var rw = (rulesA.data || []).filter(function (r) { return r.id === hitIds[h]; })[0];
        await db.from('company_rules').update({ hit_count: (Number(rw.hit_count) || 0) + hits[hitIds[h]] }).eq('id', hitIds[h]);
      }
      return NextResponse.json({ ok: true, categorized: done, problems: problems.slice(0, 20), more: todo.length > 500 });
    }

    if (action === 'mapping' || action === 'save_mapping') {
      if (comp.key !== 'nextrade') { return fail('The KTC category mapping is for Nextrade only.'); }
      if (action === 'save_mapping') {
        var catsM = await loadCats(db, cid);
        if (catsM.error) { return readFail('the categories', catsM.error); }
        var nc = (catsM.data || []).filter(function (c) { return c.key === body.category_key; })[0];
        if (!nc) { return fail('Pick one of Nextrade’s categories.'); }
        var ktc = String(body.ktc_category || '').trim() || null;
        if (ktc) { var kc = await db.from('expense_categories').select('key').eq('key', ktc).limit(1); if (kc.error) { return readFail('KTC’s categories', kc.error); } if (!kc.data || !kc.data.length) { return fail('Pick one of KTC’s categories.'); } }
        var prevM = await db.from('company_category_map').select('ktc_category').eq('company_id', cid).eq('category_key', nc.key).maybeSingle();
        if (prevM.error) { return readFail('the mapping', prevM.error); }
        var upM = await db.from('company_category_map').upsert({ company_id: cid, category_key: nc.key, ktc_category: ktc, updated_by: userId, updated_at: new Date().toISOString() }, { onConflict: 'company_id,category_key' });
        if (upM.error) { return fail('Not saved (' + upM.error.message + ').', 500); }
        // bills already made from this category that still have NO KTC category get it now (a person's own pick is never overwritten)
        var filled = 0;
        if (ktc) {
          var lkM = await db.from('company_bill_links').select('bill_id').eq('company_id', cid).eq('category_key', nc.key).eq('status', 'active').eq('mode', 'created');
          var bIds = ((lkM && lkM.data) || []).map(function (x) { return x.bill_id; }).filter(Boolean);
          for (var k = 0; k < bIds.length; k += 200) {
            var fb = await db.from('vendor_bills').update({ category: ktc, updated_at: new Date().toISOString() }).in('id', bIds.slice(k, k + 200)).is('category', null).select('id');
            if (!fb.error) { filled += (fb.data || []).length; }
          }
        }
        await audit(db, userId, 'nextrade_category_mapped', 'company_category', nc.id, { nextrade_category: nc.key, from: prevM.data ? prevM.data.ktc_category : null, to: ktc, bills_filled: filled });
        return NextResponse.json({ ok: true, bills_filled: filled });
      }
      var catsK = await loadCats(db, cid);
      var mpK = await db.from('company_category_map').select('category_key, ktc_category').eq('company_id', cid);
      var ktcCats = await db.from('expense_categories').select('key, label, active, kind').eq('active', true).order('sort');
      if (catsK.error || mpK.error || ktcCats.error) { var eK = catsK.error || mpK.error || ktcCats.error; return missingRel(eK) ? NextResponse.json({ ok: true, rows: [], sql_missing: SQL_MISSING }) : readFail('the mapping', eK); }
      var mK = {}; (mpK.data || []).forEach(function (m) { mK[m.category_key] = m.ktc_category; });
      return NextResponse.json({ ok: true, rows: (catsK.data || []).map(function (c) { return Object.assign({}, c, { ktc_category: mK[c.key] || null }); }), ktc_categories: ktcCats.data || [] });
    }

    return fail('Unknown action.');
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e && e.message) || 'error', api_build_marker: API_BUILD_MARKER }, { status: 500 });
  }
}
