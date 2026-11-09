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
export async function runPriceCheck(db, billId, pre) {
  var b = await db.from('vendor_bills').select('*').eq('id', billId).maybeSingle();
  if (b.error || !b.data) { return { error: (b.error && b.error.message) || 'Bill not found.' }; }
  var L = await loadLines(db, billId);
  if (L.error) { return { error: L.error.message, sql_missing: true }; }
  var rules = pre && pre.rules ? pre.rules : await loadPriceRules(db); var crs = pre && pre.crs ? pre.crs : await loadCommissionRules(db);
  var cr = commissionRuleFor(crs, b.data.vendor_name);
  var pc = priceCheck(b.data, L.lines, rules, cr);
  var stored = { status: pc.status, flags: pc.flags, notes: pc.notes, checked: pc.checked, lines: pc.lines, commission_rule: cr ? { vendor: cr.vendor_match, rate: Number(cr.rate) } : null };
  var patch = { price_check_status: pc.status, price_check: stored, price_check_at: new Date().toISOString() };
  var sameFlags = JSON.stringify((b.data.price_check && b.data.price_check.flags) || []) === JSON.stringify(pc.flags);
  if (b.data.validation_status !== 'validated' && !sameFlags) { patch.price_resolved_by = null; patch.price_resolved_at = null; patch.price_resolved_note = null; }
  if (b.data.validation_status !== 'validated') {
    var up = await db.from('vendor_bills').update(patch).eq('id', billId);
    if (up.error) { return { error: up.error.message, sql_missing: /price_check/.test(up.error.message), check: stored }; }
  }
  return { ok: true, check: stored, lines: pc.split_lines, commission_rule: cr, bill: b.data };
}

// after the price rules change: re-check every bill that is not validated yet (validated bills keep the check they passed)
export async function recheckOpenBills(db) {
  var r = await db.from('vendor_bills').select('id, validation_status, record_status').neq('validation_status', 'validated').eq('record_status', 'active');
  var ids = ((r && r.data) || []).map(function (x) { return x.id; });
  var n = 0; var pre = { rules: await loadPriceRules(db), crs: await loadCommissionRules(db) };
  for (var i = 0; i < ids.length && i < 400; i++) { var x = await runPriceCheck(db, ids[i], pre); if (x && x.ok) { n++; } }
  return n;
}
