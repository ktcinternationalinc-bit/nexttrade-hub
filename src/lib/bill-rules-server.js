// v55.83-WX — bill category rules, server side: load the rules and what the P&L needs to protect (categories, product-linked supplier
// descriptions), and pick the category of a NEW bill. One place, used by the bills route (typed bills, file imports), repeating bills
// and the Bill rules route. Fail-soft: before sql/v55-83-WX-bill-category-rules.sql is run there are no rules (ready: false) and new
// bills keep today's behaviour (the vendor memory), without writing the new provenance columns.
import { categoryForNew } from './bill-rules';
import { suggestCategory } from './expense-rules-server';
import { nameKey } from './profitability';

function missing(msg) { return /bill_category_rules|category_source|category_rule|does not exist|schema cache|relation/i.test(String(msg || '')); }

export async function loadBillRules(db, opts) {
  var o = opts || {};
  try {
    var q = db.from('bill_category_rules').select('*');
    if (!o.all) { q = q.eq('active', true); }
    var r = await q.order('created_at', { ascending: true }).limit(2000);
    if (r.error) { return missing(r.error.message) ? { ready: false, rules: [], error: null } : { ready: false, rules: [], error: r.error.message }; }
    return { ready: true, rules: r.data || [], error: null };
  } catch (e) { return { ready: false, rules: [], error: (e && e.message) || 'rules unreadable' }; }
}

export async function loadCategoryMap(db) {
  var r = await db.from('expense_categories').select('key, label, kind, active');
  if (r.error) { throw new Error('The categories could not be read (' + r.error.message + ').'); }
  var m = {}; (r.data || []).forEach(function (c) { m[c.key] = c; }); return m;
}

// supplier descriptions linked to a product in the P&L set-up (a line with one of these is a product cost in goods profit)
export async function loadLinkedNameKeys(db) {
  var r = await db.from('pl_group_names').select('name_key, source, active');
  if (r.error) { if (missing(r.error.message)) { return {}; } throw new Error('The product links could not be read (' + r.error.message + ').'); }
  var m = {}; (r.data || []).forEach(function (n) { if (n.active !== false && n.source !== 'invoice' && n.name_key) { m[n.name_key] = true; } }); return m;
}

// The category of a NEW bill and where it came from. bill = the row about to be inserted (vendor_name, total_amount, currency,
// wave_business_id, bill_type, release_number, bill_number, notes). lines = its lines when already known (imports), else [].
// Returns { category, source, rule_id, rule_version, conflict, blocked, ready }.
//   source 'rule'          a rule set it
//   source 'rule_conflict' rules disagree, or the best rule would deduct a bill already counted in profit — NO category (a person
//                          decides) and the vendor memory is NOT used
//   source 'vendor_memory' no rule fits: the vendor's remembered category (today's behaviour)
//   source null            nothing found
// opts.noMemory: bill rules only (the mailbox paths never used the vendor memory; they keep that)
export async function categoryForNewBill(db, bill, lines, opts) {
  var rs = await loadBillRules(db);
  if (rs.ready && rs.rules.length) {
    var cats = {}; var linked = {};
    try { cats = await loadCategoryMap(db); } catch (eC) { cats = {}; }
    try { linked = await loadLinkedNameKeys(db); } catch (eL) { linked = {}; }
    var res = categoryForNew(bill, rs.rules, cats, lines || [], linked, nameKey);
    if (res.source) {
      return { category: res.category, source: res.source, rule_id: res.rule ? res.rule.id : null, rule_version: res.rule ? (Number(res.rule.version) || 1) : null,
        conflict: res.conflict ? res.conflict.map(function (r) { return { id: r.id, name: r.name, category: r.category }; }) : null, blocked: res.blocked, ready: true };
    }
  }
  if (opts && opts.noMemory) { return { category: null, source: null, rule_id: null, rule_version: null, conflict: null, blocked: null, ready: rs.ready }; }
  var mem = null; try { mem = await suggestCategory(db, bill && bill.vendor_name); } catch (eM) { mem = null; }
  return { category: mem || null, source: mem ? 'vendor_memory' : null, rule_id: null, rule_version: null, conflict: null, blocked: null, ready: rs.ready };
}

// the provenance columns for a row about to be written (only once the WX SQL is installed)
export function provenanceFields(pick, ready) {
  if (!ready || !pick) { return {}; }
  return { category_source: pick.source || null, category_rule_id: pick.rule_id || null, category_rule_version: pick.rule_version || null };
}
