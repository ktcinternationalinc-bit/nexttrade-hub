// v55.83-RQ — server side of bill lines, the commission split and the price check (rules in ./bill-lines.js).
import { shapeLine, splitBill, priceCheck, commissionRuleFor } from './bill-lines';

export async function loadCommissionRules(db) {
  try { var r = await db.from('bill_commission_rules').select('*'); return r.error ? [] : (r.data || []).filter(function (x) { return x.active !== false; }); } catch (e) { return []; }
}
export async function loadPriceRules(db) {
  try { var r = await db.from('bill_price_rules').select('*'); return r.error ? [] : (r.data || []).filter(function (x) { return x.active !== false; }); } catch (e) { return []; }
}
export async function loadLines(db, billId) {
  var r = await db.from('vendor_bill_lines').select('*').eq('bill_id', billId).order('line_no', { ascending: true });
  if (r.error) { return { error: r.error }; }
  return { lines: r.data || [] };
}

// replace a bill's lines (a validated bill's lines are frozen — the DB trigger refuses too)
export async function saveBillLines(db, bill, rawLines, source, userId) {
  if (bill.validation_status === 'validated') { return { error: 'This bill is validated — reopen its validation to change its lines.', status: 409 }; }
  var defKind = (bill.bill_type === 'trucking' || bill.bill_type === 'shipping' || bill.bill_type === 'bonded_brokerage') ? 'charge' : 'item';
  var shaped = (rawLines || []).slice(0, 60).map(function (l, i) {
    var x = shapeLine(Object.assign({}, l, { line_no: i + 1, line_kind: l.line_kind || (/commission/i.test(String(l.description || '')) ? 'commission' : defKind) }), i);
    x.line_no = i + 1; return x;
  }).filter(function (l) { return l.description || l.amount != null; });
  var crs = await loadCommissionRules(db);
  var cr = commissionRuleFor(crs, bill.vendor_name);
  var sp = splitBill(shaped, cr);
  var del = await db.from('vendor_bill_lines').delete().eq('bill_id', bill.id);
  if (del.error) { return { error: del.error.message, status: /vendor_bill_lines/.test(del.error.message) ? 400 : 500, sql_missing: /does not exist|relation/.test(del.error.message) }; }
  if (sp.lines.length) {
    var now = new Date().toISOString();
    var rows = sp.lines.map(function (l) { return Object.assign({}, l, { bill_id: bill.id, source: source === 'read_from_bill' ? 'read_from_bill' : 'manual', created_by: userId || null, updated_at: now }); });
    var ins = await db.from('vendor_bill_lines').insert(rows);
    if (ins.error) { return { error: ins.error.message, status: 500 }; }
  }
  return { ok: true, lines: sp.lines, commission_rule: cr };
}

// the Hub's first look: compare the lines with the price rules; the result is stored on the bill.
// A NEW result clears an earlier written resolution (it resolved something else) unless the bill is already validated.
// what a flag IS (not how it is worded) — a re-worded check must not wipe a person's written resolution (review #14)
function flagSig(flags) {
  return (flags || []).map(function (f) { return [f.code, f.line_no || 0, f.rule_id || '', Math.round((Number(f.expected) || 0) * 100000), Math.round((Number(f.actual) || 0) * 100000)].join(':'); }).sort().join('|');
}

export async function runPriceCheck(db, billId, pre, opts) {
  var o = opts || {};
  var b = await db.from('vendor_bills').select('*').eq('id', billId).maybeSingle();
  if (b.error || !b.data) { return { error: (b.error && b.error.message) || 'Bill not found.' }; }
  var L = await loadLines(db, billId);
  if (L.error) { return { error: L.error.message, sql_missing: true }; }
  var rules = pre && pre.rules ? pre.rules : await loadPriceRules(db); var crs = pre && pre.crs ? pre.crs : await loadCommissionRules(db);
  var cr = commissionRuleFor(crs, b.data.vendor_name);
  var pc = priceCheck(b.data, L.lines, rules, cr);
  var stored = { status: pc.status, flags: pc.flags, notes: pc.notes, checked: pc.checked, lines: pc.lines, commission_rule: cr ? { vendor: cr.vendor_match, rate: Number(cr.rate) } : null };
  if (b.data.validation_status === 'validated' || o.readOnly) { return { ok: true, check: stored, lines: pc.split_lines, commission_rule: cr, bill: b.data, unsaved: true }; }
  // review #9 — the stored split follows the current commission rule (rate changed, vendor added / turned off): rewrite changed lines
  var fixed = 0;
  for (var k = 0; k < pc.split_lines.length; k++) {
    var nl = pc.split_lines[k]; var ol = L.lines.filter(function (x) { return x.line_no === nl.line_no; })[0];
    if (!ol || !ol.id) { continue; }
    var diff = ol.line_kind !== nl.line_kind || Number(ol.cost_amount == null ? NaN : ol.cost_amount) !== Number(nl.cost_amount == null ? NaN : nl.cost_amount) ||
      Number(ol.commission_amount == null ? NaN : ol.commission_amount) !== Number(nl.commission_amount == null ? NaN : nl.commission_amount);
    if (diff && !(ol.cost_amount == null && nl.cost_amount == null && ol.commission_amount == null && nl.commission_amount == null && ol.line_kind === nl.line_kind)) {
      var lu = await db.from('vendor_bill_lines').update({ line_kind: nl.line_kind, cost_amount: nl.cost_amount, commission_amount: nl.commission_amount, commission_rate: nl.commission_rate, updated_at: new Date().toISOString() }).eq('id', ol.id);
      if (!lu.error) { fixed++; }
    }
  }
  var patch = { price_check_status: pc.status, price_check: stored, price_check_at: new Date().toISOString() };
  var hadNote = String(b.data.price_resolved_note || '').trim().length > 0;
  var sameFlags = flagSig(b.data.price_check && b.data.price_check.flags) === flagSig(pc.flags);
  var cleared = false;
  if (!sameFlags && hadNote) { patch.price_resolved_by = null; patch.price_resolved_at = null; patch.price_resolved_note = null; cleared = true; }
  var up = await db.from('vendor_bills').update(patch).eq('id', billId);
  if (up.error) { return { error: up.error.message, sql_missing: /price_check/.test(up.error.message), check: stored }; }
  if (cleared) { // review #14 — never silently: the old resolution answered different problems
    try { await db.from('hub_audit_log').insert({ actor_id: o.actorId || null, action: 'bill_price_resolution_cleared', entity: 'vendor_bill', entity_id: String(billId),
      details: { reason: 'the price check found different problems', old_note: b.data.price_resolved_note, old_flags: ((b.data.price_check && b.data.price_check.flags) || []).map(function (f) { return f.text; }), new_flags: pc.flags.map(function (f) { return f.text; }) } }); } catch (eA) { /* fail-soft */ }
  }
  return { ok: true, check: stored, lines: pc.split_lines, commission_rule: cr, bill: b.data, lines_rewritten: fixed, resolution_cleared: cleared };
}

// after the price / commission rules change: re-check the bills that still matter — active, not validated, not fully paid —
// newest first, within a time budget so saving a rule never times out (review #8); the rest are checked when opened
export async function recheckOpenBills(db, opts) {
  var o = opts || {}; var started = Date.now(); var budget = o.budgetMs || 35000;
  var r = await db.from('vendor_bills').select('id, validation_status, record_status, total_amount, bill_date').neq('validation_status', 'validated').eq('record_status', 'active');
  var rows = ((r && r.data) || []);
  var ids = rows.map(function (x) { return x.id; });
  var paid = {};
  for (var c = 0; c < ids.length; c += 200) {
    var pr = await db.from('vendor_bill_payments').select('bill_id, amount, voided').in('bill_id', ids.slice(c, c + 200));
    ((pr && pr.data) || []).forEach(function (p) { if (p.voided !== true) { paid[p.bill_id] = (paid[p.bill_id] || 0) + (Number(p.amount) || 0); } });
  }
  var todo = rows.filter(function (x) { return (Number(x.total_amount) || 0) - (paid[x.id] || 0) > 0.005; })
    .sort(function (a, b) { return String(b.bill_date || '').localeCompare(String(a.bill_date || '')); });
  var n = 0; var pre = { rules: await loadPriceRules(db), crs: await loadCommissionRules(db) };
  for (var i = 0; i < todo.length; i++) {
    if (Date.now() - started > budget) { break; }
    var x = await runPriceCheck(db, todo[i].id, pre, { actorId: o.actorId }); if (x && x.ok) { n++; }
  }
  return { checked: n, remaining: Math.max(0, todo.length - n) };
}
