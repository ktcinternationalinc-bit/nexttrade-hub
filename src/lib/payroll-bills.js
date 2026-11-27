// v55.83-ZD (Max, 25 Nov 2026: "all of the payroll bills (partial match ok) should be all under one grouping and ... should only be
// displayed to superadmin"). ONE rule for what a payroll bill is, and ONE way the server leaves payroll out for everyone else.
//
// A bill is payroll when (any case, partial match):
//   • its vendor name contains "payroll", or starts with "Warehouse staff" (XE's Nextrade payroll bills), or
//   • its category contains "payroll" — the category key, or the label of that KTC category, or
//   • any of its lines' descriptions contains "payroll", or
//   • it is linked (company_bill_links, active) to a Nextrade category marked payroll.
// The database step (sql/v55-83-ZD-payroll-bills.sql, hub_bill_is_payroll) uses the same evidence.
//
// SUPER ADMIN ONLY sees them. For everyone else the server works with a database connection that leaves payroll out
// (payrollFilteredDb): the bills, their lines, payments and history, every wire package that pays one (header, lines, files),
// their Nextrade links, repeating bills and audit rows. Every total built on top of that connection therefore excludes payroll,
// and a write aimed at one of those rows finds nothing. Answers say so ("excluding payroll"). Fails CLOSED: if the payroll
// list or the caller's role cannot be read, nothing is shown.
// Server-only; SWC-safe: var + string concatenation.
//
// v55.83-ZD rev3 (Max, 26 Nov: hide the payroll KTC bank lines, and their Wave history and ClickBooks ledger lines, from anyone
// WITHOUT P&L access; the super admin and P&L users still see them). A bank line is payroll when (any case, partial match) its name,
// merchant, bank category, Hub / company / Wave category or classification contains (KTC lines: not the NextTrade / RTM books, which keep XE) "payroll" (e.g. "Transfer > Payroll",
// "payroll_taxes"), its Hub category's label or company category is payroll, one of its splits says "payroll", or it pays a payroll
// bill / funds a payroll wire. For a person without P&L access the same filtered connection leaves those lines (their splits and
// history) out, refuses a categorization INTO payroll, and a request naming one answers 404.
import { assertPermission, loadUserPermissions, userHasPermission } from './server-permissions';

export var PAYROLL_GROUP = 'Payroll';
export var EXCLUDING_PAYROLL = 'excluding payroll';
export var EXCLUDING_PAYROLL_NOTE = 'excluding any payroll bills (shown to the super admin only)';

function has(s) { return /payroll/i.test(String(s || '')); }

// the reasons a bill is payroll (empty = not payroll). ctx: { catLabels: { key: label }, linesBy: { bill_id: [desc] }, linked: { bill_id: true } }
export function payrollReasons(bill, ctx) {
  var b = bill || {}; var c = ctx || {}; var out = [];
  if (has(b.vendor_name)) { out.push('vendor name contains “payroll”'); }
  if (/^\s*warehouse staff/i.test(String(b.vendor_name || ''))) { out.push('vendor is “Warehouse staff” (Nextrade payroll)'); }
  if (has(b.category)) { out.push('category contains “payroll”'); }
  else if (b.category && c.catLabels && has(c.catLabels[b.category])) { out.push('category “' + c.catLabels[b.category] + '” contains “payroll”'); }
  if (c.linesBy && (c.linesBy[b.id] || []).some(has)) { out.push('a line on the bill says “payroll”'); }
  if (c.linked && c.linked[b.id]) { out.push('made from a Nextrade payroll line'); }
  return out;
}

// apply a query step only when the connection offers it (the rule is re-applied in code afterwards)
function opt(q, method, args) { return q && typeof q[method] === 'function' ? q[method].apply(q, args) : q; }
// every row, a page of 1000 at a time (a connection without paging answers in one go)
async function readAll(q) {
  var out = [];
  for (var p = 0; p < 50; p++) {
    var b = q(); var r = typeof b.range === 'function' ? await b.range(p * 1000, p * 1000 + 999) : await b;
    if (r.error) { return { error: r.error }; } out = out.concat(r.data || []);
    if (typeof b.range !== 'function' || !r.data || r.data.length < 1000) { break; }
  }
  return { data: out };
}

// Every payroll bill, with its reasons, and everything hanging off them. Read with the UNFILTERED server connection.
// → { ids: { id: [reasons] }, packages: { package_id: true }, recurring: { id: true } } | { error }
export async function loadPayrollBills(db) {
  try {
    var cats = await db.from('expense_categories').select('key, label');
    if (cats.error) { return { error: 'categories: ' + cats.error.message }; }
    var catLabels = {}; var payCatKeys = [];
    (cats.data || []).forEach(function (k) { catLabels[k.key] = k.label; if (has(k.key) || has(k.label)) { payCatKeys.push(k.key); } });
    // candidate bills by their own fields (vendor, category)
    // the database narrows the read where it can; the rule is ALWAYS applied again here (payrollReasons / has), so a connection that
    // cannot filter returns more rows, never fewer payroll bills
    var byField = await readAll(function () { return opt(opt(db.from('vendor_bills').select('id, vendor_name, category'), 'or', ['vendor_name.ilike.%payroll%,vendor_name.ilike.warehouse staff%,category.ilike.%payroll%' + (payCatKeys.length ? ',category.in.(' + payCatKeys.map(function (k) { return '"' + String(k).replace(/"/g, '') + '"'; }).join(',') + ')' : '')]), 'order', ['id']); });
    if (byField.error) { return { error: 'bills: ' + byField.error.message }; }
    var lines = await readAll(function () { return opt(opt(db.from('vendor_bill_lines').select('bill_id, description'), 'ilike', ['description', '%payroll%']), 'order', ['id']); });
    if (lines.error) { return { error: 'bill lines: ' + lines.error.message }; }
    lines.data = (lines.data || []).filter(function (l) { return has(l.description); });
    var pcats = await opt(db.from('company_categories').select('company_id, key, is_payroll'), 'eq', ['is_payroll', true]);
    if (pcats.error) { return { error: 'company categories: ' + pcats.error.message }; }
    pcats.data = (pcats.data || []).filter(function (c) { return c && c.is_payroll === true; });
    var linked = {};
    if ((pcats.data || []).length) {
      var lk = await readAll(function () { return opt(opt(opt(db.from('company_bill_links').select('bill_id, company_id, category_key, status'), 'eq', ['status', 'active']), 'in', ['category_key', pcats.data.map(function (c) { return c.key; })]), 'order', ['id']); });
      if (lk.error) { return { error: 'company links: ' + lk.error.message }; }
      var pk = {}; pcats.data.forEach(function (c) { pk[c.company_id + '|' + c.key] = true; });
      (lk.data || []).forEach(function (l) { if (l.bill_id && l.status === 'active' && pk[l.company_id + '|' + l.category_key]) { linked[l.bill_id] = true; } });
    }
    var linesBy = {}; (lines.data || []).forEach(function (l) { (linesBy[l.bill_id] = linesBy[l.bill_id] || []).push(l.description); });
    var ctx = { catLabels: catLabels, linesBy: linesBy, linked: linked };
    var ids = {}; var need = {};
    (byField.data || []).forEach(function (b) { var r = payrollReasons(b, ctx); if (r.length) { ids[b.id] = r; } });
    Object.keys(linesBy).concat(Object.keys(linked)).forEach(function (id) { if (!ids[id]) { need[id] = true; } });
    var needIds = Object.keys(need);
    for (var i = 0; i < needIds.length; i += 200) {
      var more = await opt(db.from('vendor_bills').select('id, vendor_name, category'), 'in', ['id', needIds.slice(i, i + 200)]);
      if (more.error) { return { error: 'bills: ' + more.error.message }; }
      (more.data || []).forEach(function (b) { var r = payrollReasons(b, ctx); if (r.length) { ids[b.id] = r; } });
    }
    // wire packages that pay a payroll bill: the WHOLE package is payroll (header, lines, files, history)
    var packages = {}; var idList = Object.keys(ids);
    for (var j = 0; j < idList.length; j += 200) {
      var chunk = idList.slice(j, j + 200); var inChunk = {}; chunk.forEach(function (x) { inChunk[String(x)] = true; });
      var wl = await opt(db.from('wire_package_lines').select('package_id, bill_id'), 'in', ['bill_id', chunk]);
      if (wl.error) { return { error: 'wire lines: ' + wl.error.message }; }
      (wl.data || []).forEach(function (x) { if (x.package_id && inChunk[String(x.bill_id)]) { packages[x.package_id] = true; } });
    }
    // repeating bills that would make payroll bills
    var rec = await db.from('recurring_bills').select('id, vendor_name, category');
    if (rec.error) { return { error: 'repeating bills: ' + rec.error.message }; }
    var recurring = {}; (rec.data || []).forEach(function (r) { if (payrollReasons(r, ctx).length) { recurring[r.id] = true; } });
    // what a WRITE is checked against (Codex 25 Nov: the proposed values, not only the rows already stored)
    var payLinkKeys = {}; (pcats.data || []).forEach(function (c) { payLinkKeys[c.company_id + '|' + c.key] = true; payLinkKeys['*|' + c.key] = true; });
    return { ids: ids, packages: packages, recurring: recurring, catLabels: catLabels, payLinkKeys: payLinkKeys };
  } catch (e) { return { error: (e && e.message) || 'error' }; }
}

// ---- v55.83-ZD rev3: payroll BANK LINES ----
// KTC lines only: the NextTrade / RTM books' own lines keep XE's rule (shown as “Warehouse staff” with no amount to all but the super admin)
var COMPANY_SILOS = { NEXTRADE_BOOKS: 1, RTM_BOOKS: 1 };
export function isKtcBankLine(t) { return !(t && COMPANY_SILOS[String(t.wave_business_id || '')] === 1); }
export var PAYROLL_LINES_NOTE = 'excluding payroll bank lines (shown to the super admin and people with P&L access)';
var LINE_TEXT = ['name', 'merchant_name', 'category', 'hub_category', 'company_category', 'classification', 'wave_category_name'];
var LINE_WORDS = { name: 'name', merchant_name: 'merchant', category: 'bank category', hub_category: 'Hub category', company_category: 'company category', classification: 'classification', wave_category_name: 'Wave category' };
// the reasons a bank line is payroll (empty = not payroll). ctx: { catLabels, payCompanyKeys: { key: true }, splitLines: { id: true }, billLines: { id: true } }
export function bankLineReasons(t, ctx) {
  var x = t || {}; var c = ctx || {}; var out = [];
  LINE_TEXT.forEach(function (k) { if (has(x[k])) { out.push(LINE_WORDS[k] + ' contains “payroll”'); } });
  if (x.hub_category && !has(x.hub_category) && c.catLabels && has(c.catLabels[x.hub_category])) { out.push('Hub category “' + c.catLabels[x.hub_category] + '” contains “payroll”'); }
  if (x.company_category && !has(x.company_category) && c.payCompanyKeys && c.payCompanyKeys[x.company_category]) { out.push('company category is marked payroll'); }
  if (x.id && c.splitLines && c.splitLines[x.id]) { out.push('a split says “payroll”'); }
  if (x.id && c.billLines && c.billLines[x.id]) { out.push('pays a payroll bill or wire'); }
  return out;
}
// the values a WRITE proposes for a bank line / split make it payroll
export function bankPatchIsPayroll(table, row, ctx) {
  if (!row || typeof row !== 'object') { return false; }
  if (table === 'bank_transaction_splits') { return has(row.category) || !!(row.category && ctx && ctx.catLabels && has(ctx.catLabels[row.category])); }
  var probe = {}; LINE_TEXT.forEach(function (k) { if (row[k] !== undefined) { probe[k] = row[k]; } });
  return bankLineReasons(probe, ctx).length > 0;
}
// Every payroll bank line, with its reasons. Read with the UNFILTERED server connection. pay = loadPayrollBills result.
// → { ids: { id: [reasons] }, payCompanyKeys } | { error }
export async function loadPayrollBankLines(db, pay) {
  try {
    var catLabels = (pay && pay.catLabels) || {}; var payCatKeys = Object.keys(catLabels).filter(function (k) { return has(k) || has(catLabels[k]); });
    var pc = await opt(db.from('company_categories').select('key, is_payroll'), 'eq', ['is_payroll', true]);
    if (pc.error) { return { error: 'company categories: ' + pc.error.message }; }
    var payCompanyKeys = {}; (pc.data || []).forEach(function (c) { if (c && c.is_payroll === true && c.key) { payCompanyKeys[c.key] = true; } });
    function quoted(keys) { return '(' + keys.map(function (k) { return '"' + String(k).replace(/"/g, '') + '"'; }).join(',') + ')'; }
    var ors = LINE_TEXT.map(function (k) { return k + '.ilike.%payroll%'; });
    if (payCatKeys.length) { ors.push('hub_category.in.' + quoted(payCatKeys)); }
    var ck = Object.keys(payCompanyKeys); if (ck.length) { ors.push('company_category.in.' + quoted(ck)); }
    // the database narrows the read where it can; the rule is ALWAYS applied again here (a connection that cannot filter returns more rows)
    var rows = await readAll(function () { return opt(opt(db.from('bank_transactions').select('id, wave_business_id, ' + LINE_TEXT.join(', ')), 'or', [ors.join(',')]), 'order', ['id']); });
    if (rows.error) { return { error: 'bank lines: ' + rows.error.message }; }
    var sp = await readAll(function () { return opt(db.from('bank_transaction_splits').select('id, bank_transaction_id, category'), 'order', ['id']); });
    if (sp.error) { return { error: 'bank splits: ' + sp.error.message }; }
    var splitLines = {}; (sp.data || []).forEach(function (r) { if (r && r.bank_transaction_id && (has(r.category) || has(catLabels[r.category]))) { splitLines[r.bank_transaction_id] = true; } });
    // a line that pays a payroll bill, or funds a wire that pays one
    var billLines = {}; var billIds = Object.keys((pay && pay.ids) || {}); var pkgIds = Object.keys((pay && pay.packages) || {});
    for (var i = 0; i < billIds.length; i += 200) {
      var chunk = billIds.slice(i, i + 200); var inC = {}; chunk.forEach(function (x) { inC[String(x)] = true; });
      var vp = await opt(db.from('vendor_bill_payments').select('bill_id, bank_transaction_id'), 'in', ['bill_id', chunk]);
      if (vp.error) { return { error: 'bill payments: ' + vp.error.message }; }
      (vp.data || []).forEach(function (r) { if (r && r.bank_transaction_id && inC[String(r.bill_id)]) { billLines[r.bank_transaction_id] = true; } });
    }
    for (var j = 0; j < pkgIds.length; j += 200) {
      var pch = pkgIds.slice(j, j + 200); var inP = {}; pch.forEach(function (x) { inP[String(x)] = true; });
      var wp = await opt(db.from('wire_packages').select('id, bank_transaction_id'), 'in', ['id', pch]);
      if (wp.error) { return { error: 'wires: ' + wp.error.message }; }
      (wp.data || []).forEach(function (r) { if (r && r.bank_transaction_id && inP[String(r.id)]) { billLines[r.bank_transaction_id] = true; } });
    }
    var ctx = { catLabels: catLabels, payCompanyKeys: payCompanyKeys, splitLines: splitLines, billLines: billLines };
    var ids = {}; var seen = {};
    (rows.data || []).forEach(function (t) { seen[t.id] = true; if (!isKtcBankLine(t)) { return; } var r = bankLineReasons(t, ctx); if (r.length) { ids[t.id] = r; } });
    // lines found only through a split or a bill / wire payment (their silo is read, so a NextTrade / RTM line is never taken)
    var extra = Object.keys(splitLines).concat(Object.keys(billLines)).filter(function (id) { return !seen[id]; });
    for (var q = 0; q < extra.length; q += 200) {
      var ex2 = await opt(db.from('bank_transactions').select('id, wave_business_id'), 'in', ['id', extra.slice(q, q + 200)]);
      if (ex2.error) { return { error: 'bank lines: ' + ex2.error.message }; }
      (ex2.data || []).forEach(function (t) { if (t && isKtcBankLine(t) && !ids[t.id]) { ids[t.id] = bankLineReasons({ id: t.id }, ctx); } });
    }
    return { ids: ids, payCompanyKeys: payCompanyKeys };
  } catch (e) { return { error: (e && e.message) || 'error' }; }
}

// Who is calling and what they may see. → { isSuper, pay: loadPayrollBills result } | { error, status }
export async function payrollBillScope(db, userId) {
  if (!userId) { return { error: 'Sign in again — nothing shown.', status: 401 }; }
  var u = await opt(opt(db.from('users').select('id, role'), 'eq', ['id', userId]), 'limit', [1]);
  if (u.error) { return { error: 'Your role could not be checked right now — nothing was shown or changed.', status: 503 }; }
  // the row of THIS person (checked here too, so a connection that cannot filter never makes someone else's role count)
  var me = [].concat(u.data || []).filter(function (x) { return x && String(x.id) === String(userId); })[0];
  var isSuper = !!(me && me.role === 'super_admin');
  var pay = await loadPayrollBills(db);
  if (pay.error) { return { error: 'The payroll list could not be read right now (' + pay.error + ') — nothing was shown or changed.', status: 503 }; }
  // ZD rev3 — payroll BANK LINES: the super admin and anyone with P&L access see them; for everyone else they are left out (fails closed)
  var canSeeLines = isSuper;
  if (!canSeeLines) {
    var ctxP = null; try { ctxP = await loadUserPermissions(db, userId); } catch (eP) { ctxP = null; }
    canSeeLines = !!(ctxP && !ctxP.readError && userHasPermission(ctxP, 'pnl.view'));
  }
  var lines = { ids: {} };
  if (!canSeeLines) {
    lines = await loadPayrollBankLines(db, pay);
    if (lines.error) { return { error: 'The payroll bank lines could not be read right now (' + lines.error + ') — nothing was shown or changed.', status: 503 }; }
  }
  return { isSuper: isSuper, pay: pay, count: Object.keys(pay.ids).length, canSeeLines: canSeeLines, lines: lines };
}

// The columns that point at a payroll row, per table.
function exclusions(pay, lines) {
  var billIds = Object.keys(pay.ids); var pkgIds = Object.keys(pay.packages); var recIds = Object.keys(pay.recurring);
  var lineIds = Object.keys((lines && lines.ids) || {}); // ZD rev3 — empty for the super admin / P&L users
  return {
    bank_transactions: [['id', lineIds]], bank_transactions_canonical: [['id', lineIds]], bank_transaction_splits: [['bank_transaction_id', lineIds]],
    vendor_bills: [['id', billIds]], vendor_bill_lines: [['bill_id', billIds]], vendor_bill_payments: [['bill_id', billIds]],
    vendor_bill_events: [['bill_id', billIds]], company_bill_links: [['bill_id', billIds]],
    wire_packages: [['id', pkgIds]], wire_package_lines: [['package_id', pkgIds], ['bill_id', billIds]], wire_package_files: [['package_id', pkgIds]],
    recurring_bills: [['id', recIds]], hub_audit_log: [['entity_id', billIds.concat(pkgIds, lineIds)]]
  };
}
function inList(ids) { return '(' + ids.map(function (x) { return '"' + String(x).replace(/"/g, '') + '"'; }).join(',') + ')'; }

// For anyone but the super admin: the same server connection, with payroll rows left out of every read, update and delete on the
// tables above (inserts are unchanged). The super admin gets the connection untouched.
export function payrollFilteredDb(db, scope) {
  if (!scope || scope.isSuper === true) { return db; }
  var lineScope = scope.canSeeLines === true ? null : (scope.lines || { ids: {} }); // ZD rev3
  var ex = exclusions(scope.pay, lineScope);
  var hit = {}; Object.keys(scope.pay.ids).concat(Object.keys(scope.pay.packages), Object.keys(scope.pay.recurring), Object.keys((lineScope && lineScope.ids) || {})).forEach(function (x) { hit[String(x)] = true; });
  function namesPayroll(table, rows) {
    return [].concat(rows || []).some(function (r) { return r && ['id', 'bill_id', 'package_id', 'entity_id', 'bank_transaction_id'].some(function (k) { return r[k] !== undefined && r[k] !== null && hit[String(r[k])] === true; }); });
  }
  // the values a write PROPOSES make the row payroll (Codex 25 Nov): a non-super-admin can never add or create payroll
  function proposesPayroll(table, rows) {
    var pay = scope.pay; var ctx = { catLabels: pay.catLabels || {} };
    return [].concat(rows || []).some(function (r) {
      if (!r || typeof r !== 'object') { return false; }
      if (table === 'vendor_bills' || table === 'recurring_bills') { return payrollReasons({ vendor_name: r.vendor_name, category: r.category }, ctx).length > 0; }
      if (table === 'vendor_bill_lines') { return has(r.description); }
      // ZD rev3 — categorizing a bank line (or a split) INTO payroll, by a person who could not see it afterwards
      if (table === 'bank_transactions' || table === 'bank_transaction_splits') { return !!lineScope && bankPatchIsPayroll(table, r, { catLabels: pay.catLabels || {}, payCompanyKeys: lineScope.payCompanyKeys || {} }); }
      if (table === 'company_bill_links') { var k = r.category_key; if (k === undefined || k === null) { return false; } var active = r.status === undefined || r.status === 'active'; return active && !!((pay.payLinkKeys || {})[(r.company_id || '*') + '|' + k] || (pay.payLinkKeys || {})['*|' + k]); }
      return false;
    });
  }
  // a stand-in query that answers with an error to whatever is chained on it (never written, never confirmed)
  function refused(msg) {
    var ans = { data: null, error: { code: msg ? 'P0001' : 'PGRST116', message: msg || 'not found' }, count: 0 };
    var p = new Proxy(function () {}, { get: function (t, k) { if (k === 'then') { return function (res, rej) { return Promise.resolve(ans).then(res, rej); }; } return function () { return p; }; } });
    return p;
  }
  var ONLY_SUPER = 'Payroll bills are added and changed by the super admin only (vendor, category or a line saying “payroll”, or a Nextrade payroll link). Nothing was saved.';
  var ONLY_PNL = 'Payroll bank lines are categorized by the super admin or someone with P&L access only (a category, name or split saying “payroll”). Nothing was saved.';
  var BANK_TABLES = { bank_transactions: 1, bank_transactions_canonical: 1, bank_transaction_splits: 1 };
  function narrow(table, fb) {
    var rules = ex[table]; if (!rules || !fb) { return fb; }
    var needed = rules.some(function (r) { return r[1].length > 0; });
    if (!needed) { return fb; }
    if (typeof fb.not !== 'function') { return refused('This connection cannot leave payroll out — nothing was shown or changed.'); } // fail closed
    rules.forEach(function (r) { if (r[1].length) { fb = fb.not(r[0], 'in', inList(r[1])); } });
    return fb;
  }
  return new Proxy(db, { get: function (target, prop) {
    if (prop === 'from') {
      return function (table) {
        var qb = target.from(table);
        if (!ex[table]) { return qb; }
        return new Proxy(qb, { get: function (t2, p2) {
          var v = t2[p2];
          if (typeof v !== 'function') { return v; }
          if (p2 === 'select' || p2 === 'delete') { return function () { return narrow(table, v.apply(t2, arguments)); }; }
          // an update whose NEW values make the row payroll is refused; otherwise it never reaches a payroll row
          if (p2 === 'update') { return function (patch) { if (proposesPayroll(table, patch)) { return refused(BANK_TABLES[table] ? ONLY_PNL : ONLY_SUPER); } return narrow(table, v.apply(t2, arguments)); }; }
          // an insert / upsert that names a payroll row (its id, bill or package), or whose values ARE payroll, is refused
          if (p2 === 'upsert' || p2 === 'insert') { return function (rows) { if (namesPayroll(table, rows)) { return refused(); } if (table !== 'bank_transactions' && proposesPayroll(table, rows)) { return refused(BANK_TABLES[table] ? ONLY_PNL : ONLY_SUPER); } return v.apply(t2, arguments); }; }
          return v.bind(t2);
        } });
      };
    }
    // a database function called with a payroll bill / package anywhere in its arguments (pay, allocate, sign, link…) is refused
    if (prop === 'rpc') {
      return function (name, args) {
        if (mentionsPayroll(args)) { return refused(); }
        // categorizing a Nextrade line INTO a payroll category makes / links a payroll bill: the super admin's own action (ZD, Codex 25 Nov)
        // (only Nextrade lines make / link KTC bills; RTM lines never do, so categorizing them changes no bill)
        if (/^hub_company_categorize/.test(String(name)) && args && args.p && args.p.category_key && String(args.p.company_id || '') === 'NEXTRADE_BOOKS' && proposesPayroll('company_bill_links', [{ company_id: args.p.company_id, category_key: args.p.category_key }])) { return refused(ONLY_SUPER); }
        return target.rpc.apply(target, arguments);
      };
    }
    var val = target[prop]; return typeof val === 'function' ? val.bind(target) : val;
  } });
  function mentionsPayroll(v) {
    if (v === null || v === undefined) { return false; }
    if (typeof v === 'string' || typeof v === 'number') { return hit[String(v)] === true; }
    if (Array.isArray(v)) { return v.some(mentionsPayroll); }
    if (typeof v === 'object') { return Object.keys(v).some(function (k) { return mentionsPayroll(v[k]); }); }
    return false;
  }
}

// does a request (its body) name a payroll bill / wire package / repeating bill? For a non-super-admin the route then answers
// 404 "not found", exactly as for a bill that does not exist.
export function requestNamesPayroll(scope, body) {
  if (!scope || scope.isSuper === true) { return false; }
  var hit = {}; Object.keys(scope.pay.ids).concat(Object.keys(scope.pay.packages), Object.keys(scope.pay.recurring), scope.canSeeLines === true ? [] : Object.keys((scope.lines && scope.lines.ids) || {})).forEach(function (x) { hit[String(x)] = true; });
  return (function walk(v) {
    if (v === null || v === undefined) { return false; }
    if (typeof v === 'string' || typeof v === 'number') { return hit[String(v)] === true; }
    if (Array.isArray(v)) { return v.some(walk); }
    if (typeof v === 'object') { return Object.keys(v).some(function (k) { return walk(v[k]); }); }
    return false;
  })(body);
}

// Codex 25 Nov — a label goes on the TOTAL it describes, with the SAME words for every non-super-admin whether or not any payroll
// exists (so the label itself never tells anyone that payroll exists). The super admin gets no label (nothing is left out).
export function payrollBillsNote(scope) { return scope && scope.isSuper !== true ? EXCLUDING_PAYROLL_NOTE : undefined; }
// ZD rev3 — the same fixed words for everyone who cannot see payroll bank lines; nothing for the super admin / P&L users
export function payrollLinesNote(scope) { return scope && scope.canSeeLines !== true ? PAYROLL_LINES_NOTE : undefined; }

// Max 25 Nov: "it must be used in the PNL of the reports and tax and in the PNL profitability ... seen ... to those who do [have P&L
// access] and superadmin" — in the P&L / tax / Profitability figures payroll is ALWAYS counted and shown to the super admin and anyone
// with P&L: View. → true / false; a failed read is false (fails closed).
export async function pnlAccess(db, userId, req) {
  try { var g = await assertPermission(db, userId, 'pnl.view', req); return !!(g && g.ok === true); } catch (e) { return false; }
}
export var SPENDING_WITHHELD = 'Spending, tax and P&L figures need P&L access (they include payroll) — they are withheld, not zero.';
