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

export var PAYROLL_GROUP = 'Payroll';
export var EXCLUDING_PAYROLL = 'excluding payroll';
export var EXCLUDING_PAYROLL_NOTE = 'Totals here are excluding payroll — payroll bills are shown to the super admin only.';

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
    return { ids: ids, packages: packages, recurring: recurring };
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
  return { isSuper: isSuper, pay: pay, count: Object.keys(pay.ids).length };
}

// The columns that point at a payroll row, per table.
function exclusions(pay) {
  var billIds = Object.keys(pay.ids); var pkgIds = Object.keys(pay.packages); var recIds = Object.keys(pay.recurring);
  return {
    vendor_bills: [['id', billIds]], vendor_bill_lines: [['bill_id', billIds]], vendor_bill_payments: [['bill_id', billIds]],
    vendor_bill_events: [['bill_id', billIds]], company_bill_links: [['bill_id', billIds]],
    wire_packages: [['id', pkgIds]], wire_package_lines: [['package_id', pkgIds], ['bill_id', billIds]], wire_package_files: [['package_id', pkgIds]],
    recurring_bills: [['id', recIds]], hub_audit_log: [['entity_id', billIds.concat(pkgIds)]]
  };
}
function inList(ids) { return '(' + ids.map(function (x) { return '"' + String(x).replace(/"/g, '') + '"'; }).join(',') + ')'; }

// For anyone but the super admin: the same server connection, with payroll rows left out of every read, update and delete on the
// tables above (inserts are unchanged). The super admin gets the connection untouched.
export function payrollFilteredDb(db, scope) {
  if (!scope || scope.isSuper === true) { return db; }
  var ex = exclusions(scope.pay);
  var hit = {}; Object.keys(scope.pay.ids).concat(Object.keys(scope.pay.packages), Object.keys(scope.pay.recurring)).forEach(function (x) { hit[String(x)] = true; });
  function namesPayroll(table, rows) {
    return [].concat(rows || []).some(function (r) { return r && ['id', 'bill_id', 'package_id', 'entity_id'].some(function (k) { return r[k] !== undefined && r[k] !== null && hit[String(r[k])] === true; }); });
  }
  // a stand-in query that answers "not found" to whatever is chained on it
  function refused() {
    var ans = { data: null, error: { code: 'PGRST116', message: 'not found' }, count: 0 };
    var p = new Proxy(function () {}, { get: function (t, k) { if (k === 'then') { return function (res, rej) { return Promise.resolve(ans).then(res, rej); }; } return function () { return p; }; } });
    return p;
  }
  function narrow(table, fb) {
    var rules = ex[table]; if (!rules || !fb || typeof fb.not !== 'function') { return fb; }
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
          if (p2 === 'select' || p2 === 'update' || p2 === 'delete') { return function () { return narrow(table, v.apply(t2, arguments)); }; }
          // an insert / upsert that names a payroll row (its id, bill or package) is refused: never written, never confirmed
          if (p2 === 'upsert' || p2 === 'insert') { return function (rows) { if (namesPayroll(table, rows)) { return refused(); } return v.apply(t2, arguments); }; }
          return v.bind(t2);
        } });
      };
    }
    // a database function called with a payroll bill / package anywhere in its arguments (pay, allocate, sign, link…) is refused
    if (prop === 'rpc') {
      return function (name, args) { if (mentionsPayroll(args)) { return refused(); } return target.rpc.apply(target, arguments); };
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
  var hit = {}; Object.keys(scope.pay.ids).concat(Object.keys(scope.pay.packages), Object.keys(scope.pay.recurring)).forEach(function (x) { hit[String(x)] = true; });
  return (function walk(v) {
    if (v === null || v === undefined) { return false; }
    if (typeof v === 'string' || typeof v === 'number') { return hit[String(v)] === true; }
    if (Array.isArray(v)) { return v.some(walk); }
    if (typeof v === 'object') { return Object.keys(v).some(function (k) { return walk(v[k]); }); }
    return false;
  })(body);
}

// The route's answer, labelled for a non-super-admin when payroll bills exist: { ..., payroll_excluded: EXCLUDING_PAYROLL_NOTE }.
// Only a JSON object answer is touched; status and headers are kept.
export async function withPayrollLabel(req, res) {
  var sc = null; try { sc = req && req.__payZD; } catch (e) { sc = null; }
  if (!res || !sc || sc.isSuper === true || !(sc.count > 0)) { return res; }
  var ct = ''; try { ct = String(res.headers.get('content-type') || ''); } catch (e2) { ct = ''; }
  if (ct.indexOf('application/json') < 0) { return res; }
  var body = null; try { body = await res.clone().json(); } catch (e3) { return res; }
  if (!body || typeof body !== 'object' || Array.isArray(body)) { return res; }
  body.payroll_excluded = EXCLUDING_PAYROLL_NOTE;
  var h = new Headers(res.headers); h.delete('content-length');
  return new Response(JSON.stringify(body), { status: res.status, headers: h });
}

// for an answer to a non-super-admin: say that totals exclude payroll (only when payroll exists, so nothing changes otherwise)
export function excludingNote(scope) { return scope && scope.isSuper !== true && scope.count > 0 ? EXCLUDING_PAYROLL_NOTE : undefined; }
