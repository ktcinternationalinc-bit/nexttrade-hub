// v55.83-XU — Max, 22 Nov 2026: "i need to be able to uncATEORIZE A SELCTION AFTER I CATEGORIZE IT." Runs the REAL expense-rules
// route (clear_category, bulk_classify), the REAL permission resolver, private-account scope and history window, and the REAL rule
// run, on an in-memory database. The database step itself (sql/v55-83-XU-clear-category.sql) is RUN on real Postgres in
// test-v55-83-xu-clear-category-real-postgres.mjs; here it is a stand-in that clears the line, so the route's own behaviour is
// shown: restricted lines say nothing about themselves (Codex 18:08 P1), refusals from the step are named, a step that is not
// installed or does not answer changes nothing, a partial batch names each line, and the rules never refill a cleared line.
// All lines are made up.
var path = require('path'); var Module = require('module'); var fs = require('fs');
var root = path.join(__dirname, '..');
process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'x';
require(path.join(root, 'node_modules/sucrase/register'));
var MemDB = require('./helpers/memdb-wires.js');
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra).substring(0, 900))); }
var mockPath = path.join(__dirname, 'helpers', 'mock-supabase-js.js');
fs.writeFileSync(mockPath, 'module.exports={createClient:function(){return global.__db;}};');
var orig = Module._resolveFilename;
Module._resolveFilename = function (req) { if (req === '@supabase/supabase-js') { return mockPath; } if (/lib[\/]verified-caller(.js)?$/.test(req)) { return path.join(__dirname, 'helpers', 'stub-verified-caller.js'); } return orig.apply(this, arguments); };
var US = require(path.join(root, 'src/lib/business-of.js')).US_WAVE_BUSINESS_ID;
function tx(id, name, o) { return Object.assign({ id: id, name: name, merchant_name: null, direction: 'out', classification: 'utilities', category_source: 'classification', category_verified: false, review_status: 'reviewed', reviewed_by: 'u1', reviewed_at: '2026-11-10T00:00:00.000Z', wave_business_id: US, transfer_group_id: null, matched_invoice_id: null, pending: false, account_id: 'A1', date: '2026-11-05', posted_date: '2026-11-05', amount_abs: 10, amount: -10, wave_account_id: 'W-UTIL', wave_account_name: 'Utilities (Wave)', category_status: 'pending_wave_sync', wave_sync_status: 'not_synced', sync_status: 'not_synced' }, o || {}); }
var stepMode = 'ok'; var stepCodes = {}; var stepCalls = []; var stepFailAt = null;
function freshDb(extra) {
  stepMode = 'ok'; stepCodes = {}; stepCalls = []; stepFailAt = null;
  var db = new MemDB({
    users: [{ id: 'u1', role: 'super_admin', name: 'Max' }, { id: 'staff', role: 'employee', name: 'Staff' }, { id: 'adm', role: 'admin', name: 'Admin' }],
    module_permissions: [{ user_id: 'staff', module_name: 'accounting.view', has_access: true }, { user_id: 'staff', module_name: 'bank.classify', has_access: true },
      { user_id: 'adm', module_name: 'accounting.view', has_access: true }, { user_id: 'adm', module_name: 'bank.classify', has_access: true }],
    app_settings: [{ key: 'accounting_visibility_window', value: { window: 'custom', customFrom: '2026-11-01' } }],
    expense_categories: [{ key: 'utilities', label: 'Utilities', wave_account_id: 'W-UTIL', wave_account_name: 'Utilities (Wave)' }, { key: 'rent', label: 'Rent' }, { key: 'professional_fees', label: 'Professional fees', active: true }],
    us_expense_rules: [], hub_audit_log: [], plaid_accounts: [{ plaid_account_id: 'PRIV', is_private: true }], accounting_invoice_payments: [], vendor_bill_payments: [], bank_transaction_splits: [], bank_unapplied: [], customer_credits: [], wave_categories: [],
    bank_transactions: [
      tx('t1', 'PUBLIC SERVICE ELEC 0001234 NOV'),
      tx('t2', 'PUBLIC SERVICE ELEC 0009876 DEC', { review_status: 'unreviewed', reviewed_by: null, reviewed_at: null }),
      tx('t3', 'AMAZON MKTPL 12345', { classification: null, category_source: null, wave_account_id: null, wave_account_name: null, category_status: 'local_only', review_status: 'unreviewed', reviewed_by: null, reviewed_at: null }),
      tx('P1', 'PRIVATE PAYEE QA', { account_id: 'PRIV', amount_abs: 9876.54, date: '2026-11-06', posted_date: '2026-11-06' }),
      tx('OLD', 'OLDER PAYEE QA', { amount_abs: 5555.55, date: '2026-09-01', posted_date: '2026-09-01' })
    ].concat(extra || [])
  });
  // stand-in for hub_bank_clear_category (its real behaviour is RUN on Postgres in the .mjs test)
  db.rpc = function (name, args) {
    if (name !== 'hub_bank_clear_category') { return Promise.resolve({ data: null, error: { message: 'no rpc ' + name } }); }
    var p = args.p; stepCalls.push(p);
    if (stepMode === 'missing') { return Promise.resolve({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.hub_bank_clear_category(p) in the schema cache' } }); }
    if (stepMode === 'down' || stepFailAt === p.id) { return Promise.resolve({ data: null, error: { message: 'statement timeout' } }); }
    if (stepCodes[p.id]) { return Promise.resolve({ data: Object.assign({ ok: false }, stepCodes[p.id]), error: null }); }
    var t = db.t.bank_transactions.filter(function (x) { return x.id === p.id; })[0];
    if (!t) { return Promise.resolve({ data: { ok: false, code: 'missing' }, error: null }); }
    if (t.classification !== p.expect.classification || t.category_source !== p.expect.category_source) { return Promise.resolve({ data: { ok: false, code: 'changed' }, error: null }); }
    if (!t.classification) { return Promise.resolve({ data: { ok: false, code: 'blank' }, error: null }); }
    var fin = t.review_status === 'reviewed' || t.review_status === 'approved';
    Object.assign(t, { classification: null, category_source: 'cleared', wave_account_id: null, wave_account_name: null, category_status: 'local_only' }, fin ? { review_status: 'unreviewed', reviewed_by: null, reviewed_at: null } : {});
    db.t.hub_audit_log.push({ id: 'a' + db.t.hub_audit_log.length, actor_id: p.actor, action: 'category_removed', entity: 'bank_transaction', entity_id: p.id });
    return Promise.resolve({ data: { ok: true, code: 'cleared' }, error: null });
  };
  global.__db = db; return db;
}
freshDb();
var route = require(path.join(root, 'src/app/api/accounting/expense-rules/route.js'));
var C = require(path.join(root, 'src/lib/category-clear-server.js'));
var ER = require(path.join(root, 'src/lib/expense-rules-server.js'));
async function call(body, user) { var res = await route.POST({ json: function () { return Promise.resolve(Object.assign({ user_id: user || 'u1' }, body)); }, headers: { get: function () { return null; } } }); var j = await res.json(); j._status = res.status; return j; }
function row(id) { return global.__db.t.bank_transactions.filter(function (t) { return t.id === id; })[0]; }
function clear(ids, user, o) { return call({ action: 'clear_category', payload: Object.assign({ ids: ids, confirm: true }, o || {}) }, user); }
function snap() { return JSON.stringify(global.__db.t.bank_transactions); }

(async function () {
  // ── 1. the clear, through the database step
  var r1 = await clear(['t1', 't2']);
  check('CLEAR: both lines go through the database step with the actor, the company and the EXACT state read (incl. pending, account and dates)', r1.ok === true && r1.cleared.length === 2 && stepCalls.length === 2 && stepCalls[0].actor === 'u1' && stepCalls[0].business === US && stepCalls[0].expect.classification === 'utilities' && stepCalls[0].expect.pending === false && stepCalls[0].expect.account_id === 'A1' && stepCalls[0].expect.posted_date === '2026-11-05' && stepCalls[0].expect.wave_sync_status === 'not_synced', [r1, stepCalls[0]]);
  check('CLEAR: the lines are Uncategorized, marked cleared; the answer says so in plain words', row('t1').classification === null && row('t1').category_source === 'cleared' && /Category taken off 2 line\(s\)/.test(r1.message) && /rules will not fill them again/.test(r1.message), r1.message);
  freshDb(); var r1b = await clear(['t1', 't3']);
  check('ALREADY BLANK: counted, not an error, and the step is not even called for it', r1b.ok === true && r1b.cleared.length === 1 && r1b.already === 1 && stepCalls.length === 1, r1b);

  // ── 2. (Codex P1) a line this person may not see says NOTHING about itself — staff, ordinary admin, history window, not found
  async function whole(user, ids) { freshDb(); var r = await clear(ids, user); return { r: r, txt: JSON.stringify(r) }; }
  var st = await whole('staff', ['P1', 't1']);
  check('P1 STAFF: a private-account line in a mixed selection → only its ID and "restricted"; no payee, date, amount, direction, account or reason anywhere in the whole answer; the visible line is cleared', st.r.ok === true && st.r.cleared.length === 1 && st.r.cleared[0] === 't1' && st.r.refused.length === 1 && JSON.stringify(st.r.refused[0]) === JSON.stringify({ id: 'P1', restricted: true, why: 'restricted' }) && !/PRIVATE PAYEE|9876|2026-11-06|PRIV\b|private bank account/.test(st.txt) && row('P1').classification === 'utilities', st.r);
  check('P1 STAFF: the restricted line never reached the database step', !stepCalls.some(function (p) { return p.id === 'P1'; }));
  var ad = await whole('adm', ['P1']);
  check('P1 ORDINARY ADMIN (accounting + classify, no private access): the same — ID and "restricted" only', ad.r.ok === true && ad.r.cleared.length === 0 && JSON.stringify(ad.r.refused) === JSON.stringify([{ id: 'P1', restricted: true, why: 'restricted' }]) && !/PRIVATE PAYEE|9876/.test(ad.txt) && row('P1').classification === 'utilities', ad.r);
  var wn = await whole('staff', ['OLD']);
  check('P1 HISTORY WINDOW: a line older than the person may see → ID and "restricted" only (no payee, date, amount)', wn.r.ok === true && JSON.stringify(wn.r.refused) === JSON.stringify([{ id: 'OLD', restricted: true, why: 'restricted' }]) && !/OLDER PAYEE|5555|2026-09-01|older than/.test(wn.txt) && row('OLD').classification === 'utilities', wn.r);
  var nf = await whole('staff', ['nope', 't1']);
  check('NOT FOUND: an unknown ID is answered exactly like a restricted one; the rest still runs', nf.r.ok === true && JSON.stringify(nf.r.refused) === JSON.stringify([{ id: 'nope', restricted: true, why: 'restricted' }]) && nf.r.cleared[0] === 't1', nf.r);
  var su = await whole('u1', ['P1', 'OLD']);
  check('SUPER ADMIN: sees all accounts and all history → both lines cleared', su.r.ok === true && su.r.cleared.length === 2 && row('P1').classification === null, su.r);
  check('the visible message only counts restricted lines ("you may not change"), never describes them', /1 you may not change/.test(st.r.message) && !/PRIVATE/.test(st.r.message), st.r.message);

  // ── 3. refusals from the step are named, for lines the person may see
  var CODES = { ledger: /ClickBooks ledger/, wave: /sent to Wave/, closed: /month is closed \(books closed through 2026-10-31\)/, transfer: /paired as a transfer/, invoice: /invoice payment/, match: /payment match/, bill: /pays a bill/, split: /split into parts/, held: /unapplied deposit or customer credit/, wire: /Wires screen/, funds: /company funds/, adjustment: /manual bank adjustment/, order: /order deposit/, treasury: /Treasury/, verified: /verified/, pending: /pending/, duplicate: /duplicate/, changed: /changed by someone a moment ago/ };
  var okAll = true; var bad = [];
  for (var code in CODES) {
    freshDb(); stepCodes.t1 = { code: code, through: '2026-10-31' }; var rc = await clear(['t1', 't2']);
    var x = (rc.refused || [])[0];
    if (!(rc.ok === true && rc.cleared.length === 1 && rc.cleared[0] === 't2' && x && x.id === 't1' && x.code === code && CODES[code].test(x.why) && x.who && x.date === '2026-11-05' && x.amount === 10 && row('t1').classification === 'utilities')) { okAll = false; bad.push([code, rc]); }
  }
  check('STEP REFUSALS: each of the 18 codes (ledger, Wave, closed month, transfer, invoice, payment match, bill, split, held money, wire, company funds, adjustment, order deposit, treasury, verified, pending, duplicate, changed) → that line named with date / payee / amount / where to fix it; the other line cleared', okAll, bad);

  // ── 4. fail closed, partial batches
  freshDb(); stepMode = 'missing'; var s4 = snap(); var r4 = await clear(['t1', 't2']);
  check('STEP NOT INSTALLED: refused, the database step named, NOTHING changed', r4.ok === false && r4.needs_sql === true && /v55-83-XU-clear-category\.sql/.test(r4.error) && snap() === s4, r4);
  freshDb(); stepMode = 'down'; var s5 = snap(); var r5 = await clear(['t1', 't2']);
  check('STEP NOT ANSWERING before anything changed → refused (503), NOTHING changed', r5.ok === false && r5._status === 503 && snap() === s5, r5);
  freshDb(); stepFailAt = 't2'; var r6 = await clear(['t1', 't2']);
  check('PARTIAL: the step fails on the 2nd line after the 1st was cleared → the answer names each line (1 cleared, 1 "could not be saved just now")', r6.ok === true && r6.cleared[0] === 't1' && r6.refused.length === 1 && r6.refused[0].id === 't2' && /could not be saved just now/.test(r6.refused[0].why) && row('t2').classification === 'utilities', r6);
  freshDb(); var s7 = snap(); var r7 = await call({ action: 'clear_category', payload: { ids: ['t1'] } });
  check('ASKS FIRST: without the confirmation nothing is changed', r7.ok === false && r7._status === 400 && /Confirm first/.test(r7.error) && snap() === s7 && stepCalls.length === 0, r7);
  var many = []; for (var k = 0; k < 501; k++) { many.push('z' + k); } var r8 = await clear(many);
  check('At most 500 lines at a time', r8.ok === false && /At most 500/.test(r8.error), r8);
  freshDb(); var r9 = await clear(['t1'], 'nobody');
  check('PERMISSION: a person without Accounting access is refused before anything is read', r9.ok === false && r9._status === 403 && stepCalls.length === 0, r9);
  var srcC = fs.readFileSync(path.join(root, 'src/lib/category-clear-server.js'), 'utf8');
  check('NO AUDIT WRITTEN OUTSIDE THE STEP: the change and its audit row are written together by hub_bank_clear_category (no separate, ignorable audit insert in JS)', !/hub_audit_log/.test(srcC.replace(/^\/\/.*$/mg, '')) && /db\.rpc\('hub_bank_clear_category'/.test(srcC));

  // ── 5. the rules never fill a cleared line again; the bank sync never writes a category; a person can pick again
  freshDb(); var pk = await call({ action: 'bulk_classify', payload: { ids: ['t3'], classification: 'rent', single_pick: true } });
  check('SETUP: a person picks Rent on a line — a rule is learned that matches it', pk.ok === true && global.__db.t.us_expense_rules.length === 1 && row('t3').classification === 'rent', pk);
  await clear(['t3']);
  var run = await ER.applyExpenseRules(global.__db, 1000);
  check('RULE RUN (every 15 min): the cleared line is NOT filled again by the rule that matches it', row('t3').classification === null && row('t3').category_source === 'cleared', [run, row('t3')]);
  var pv = await ER.previewRule(global.__db, global.__db.t.us_expense_rules[0].match_text, 'rent');
  check('RULE PREVIEW: a cleared line counts as a person’s choice ("human"), not a blank to fill', pv.buckets.human.some(function (t) { return t.id === 't3'; }) && !pv.buckets.blank.some(function (t) { return t.id === 't3'; }), pv.buckets);
  var lk = await ER.applyLookAlikes(global.__db, global.__db.t.us_expense_rules[0].id, 'rent', 'u1');
  check('LOOK-ALIKE FILL: a later pick that spreads to look-alikes leaves the cleared line alone', row('t3').classification === null, lk);
  var WAM = require(path.join(root, 'src/lib/wire-auto-match.js'));
  var fp = await WAM.fileAsProfessionalFees(global.__db, 't3', 'u1', { payee_name: 'RTM' });
  check('WIRE AUTO-FILE: a cleared line is never filed as Professional fees automatically', fp === null && row('t3').classification === null, fp);
  var BI = require(path.join(root, 'src/lib/bank-ingest.js'));
  var mapped = BI.mapPlaidTransaction({ transaction_id: 'ptx-1', account_id: 'A1', amount: 10, date: '2026-11-05', name: 'AMAZON MKTPL 12345', pending: false }, { id: 'c1', wave_business_id: US }, { A1: { account_id: 'A1' } }, {});
  check('BANK SYNC: the row the sync writes carries NO category, category source, review status or Wave category — a re-sync of a cleared line leaves it cleared', mapped && !('classification' in mapped) && !('category_source' in mapped) && !('review_status' in mapped) && !('wave_account_id' in mapped), Object.keys(mapped || {}));
  var again = await call({ action: 'bulk_classify', payload: { ids: ['t3'], classification: 'utilities', single_pick: true } });
  check('A PERSON can pick a category on a cleared line again — it saves as theirs', again.ok === true && row('t3').classification === 'utilities' && row('t3').category_source === 'classification', again);

  // ── 5b. (Codex 20:34) the ONE-line screens show the line's own reason — the REAL handlers run with REAL route answers
  async function answer(kind) {
    freshDb();
    if (kind === 'bill') { stepCodes.t1 = { code: 'bill' }; return clear(['t1']); }
    if (kind === 'verified') { stepCodes.t1 = { code: 'verified' }; return clear(['t1']); }
    if (kind === 'restricted') { return clear(['P1'], 'staff'); }
    return clear(['t1']);
  }
  var ansBill = await answer('bill'); var ansVer = await answer('verified'); var ansRes = await answer('restricted'); var ansOk = await answer('ok');
  function extractFn(src, header) { var i = src.indexOf(header); if (i < 0) { return null; } var j = src.indexOf('{', i); var d = 0; for (var k2 = j; k2 < src.length; k2++) { if (src[k2] === '{') { d++; } else if (src[k2] === '}') { d--; if (d === 0) { return src.substring(i, k2 + 1); } } } return null; }
  var W = require(path.join(root, 'src/lib/category-clear-words.js'));
  var brSrc = fs.readFileSync(path.join(root, 'src/components/BankReviewTab.jsx'), 'utf8');
  var ptSrc = fs.readFileSync(path.join(root, 'src/components/ProfitabilityTab.jsx'), 'utf8');
  async function runBankReview(ans) {
    var st = { toasts: [], sel: null, loads: 0, calls: 0, busy: null };
    var fnTxt = extractFn(brSrc, 'function removeCategory(t) {');
    var f = new Function('mayClassify', 'window', 'setBusy', 'hubFetch', 'singleLineWords', 'toast', 'setSel', 'load', fnTxt + '; return removeCategory;')(
      true, { confirm: function () { return true; } }, function (v) { st.busy = v; },
      function () { st.calls++; return Promise.resolve({ status: 200, json: function () { return Promise.resolve(ans); } }); }, W.singleLineWords,
      { success: function (t) { st.toasts.push('ok:' + t); }, error: function (t) { st.toasts.push('err:' + t); } }, function (v) { st.sel = v; }, function () { st.loads++; });
    f({ id: 't1', classification: 'utilities' }); await new Promise(function (r) { setTimeout(r, 20); }); return st;
  }
  async function runProfit(ans) {
    var st = { toasts: [], reloads: 0, calls: 0 };
    var fnTxt = extractFn(ptSrc, 'function pickCat(row, key) {');
    var f = new Function('window', 'setCatSaving', 'erApi', 'singleLineWords', 'toast', 'startExpenses', 'setUndoPt', 'catList', fnTxt + '; return pickCat;')(
      { confirm: function () { return true; } }, function () {}, function () { st.calls++; return Promise.resolve(ans); }, W.singleLineWords,
      { success: function (t) { st.toasts.push('ok:' + t); }, error: function (t) { st.toasts.push('err:' + t); } }, function () { st.reloads++; }, function () {}, []);
    f({ id: 't1', who: 'PUBLIC SERVICE ELEC' }, '__remove__'); await new Promise(function (r) { setTimeout(r, 20); }); return st;
  }
  var screens = [['BANK REVIEW', runBankReview], ['PROFITABILITY line', runProfit]];
  for (var si = 0; si < screens.length; si++) {
    var nm = screens[si][0]; var run = screens[si][1];
    var sB = await run(ansBill); var sV = await run(ansVer); var sR = await run(ansRes); var sO = await run(ansOk);
    check(nm + ' (real handler, real route answer) — BILL-LINKED line: one request, one error that says the line kept its category, why, and where to fix it (Bills); never "listed"', sB.calls === 1 && sB.toasts.length === 1 && sB.toasts[0] === 'err:Category kept: it pays a bill — take the payment off the bill first (Bills).' && !/listed/.test(sB.toasts[0]), sB.toasts);
    check(nm + ' — VERIFIED line: "Category kept: its category is verified — take the ✓ verified mark off first."', sV.toasts.length === 1 && sV.toasts[0] === 'err:Category kept: its category is verified — take the ✓ verified mark off first.', sV.toasts);
    check(nm + ' — RESTRICTED line: generic only — no payee, account, amount or date; never "listed"', sR.toasts.length === 1 && sR.toasts[0] === 'err:Category kept: you may not change this line.' && !/PRIVATE|9876|PRIV|listed/.test(sR.toasts[0]), sR.toasts);
    check(nm + ' — SUCCESS: a success message and the screen reloads', sO.toasts.length === 1 && /^ok:Category removed/.test(sO.toasts[0]) && (nm === 'BANK REVIEW' ? (sO.loads === 1 && sO.sel && sO.sel.classification === null) : sO.reloads === 1), [sO.toasts, sO.loads, sO.reloads]);
    check(nm + ' — on a refusal nothing on the screen changes (no reload, the line keeps its category)', (nm === 'BANK REVIEW' ? (sB.loads === 0 && sB.sel === null && sR.sel === null) : (sB.reloads === 0 && sR.reloads === 0)));
  }
  check('words: an error answer is said as it is; a blank line is said plainly', W.singleLineWords({ ok: false, error: 'Confirm first — nothing was changed.' }).text === 'Confirm first — nothing was changed.' && W.singleLineWords({ ok: true, cleared: [], refused: [], already: 1 }).text === 'This line has no category already.');

  // ── 6. the screens
  var at = fs.readFileSync(path.join(root, 'src/components/AllTransactionsTab.jsx'), 'utf8');
  var br = fs.readFileSync(path.join(root, 'src/components/BankReviewTab.jsx'), 'utf8');
  var ps = fs.readFileSync(path.join(root, 'src/components/PeriodStatsTab.jsx'), 'utf8');
  var pt = fs.readFileSync(path.join(root, 'src/components/ProfitabilityTab.jsx'), 'utf8');
  var cb = fs.readFileSync(path.join(root, 'src/components/CompanyBooksTab.jsx'), 'utf8');
  var rt = fs.readFileSync(path.join(root, 'src/app/api/accounting/expense-rules/route.js'), 'utf8');
  check('ALL TRANSACTIONS: "✕ Remove category" on the selection, asks first with the count, sends confirm', /✕ Remove category/.test(at) && /window\.confirm\('Take the category off ' \+ selIds\.length/.test(at) && /api\('clear_category', \{ ids: selIds, confirm: true \}\)/.test(at));
  check('ALL TRANSACTIONS (Codex usability): the lines LEFT stay listed with date / payee / amount / reason until closed; restricted lines only counted', /setLeftList\(j\.refused\)/.test(at) && /\{leftPanel\(\)\}/.test(at) && /x\.restricted/.test(at) && /you may not change were left as they are/.test(at));
  check('BANK REVIEW: "✕ Remove category" on the selected line (only when it has one), asks first', /removeCategory\(sel\)/.test(br) && /sel\.classification && mayClassify/.test(br) && /action: 'clear_category', payload: \{ ids: \[t\.id\], confirm: true \}/.test(br) && /import \{ hubFetch \} from '\.\.\/lib\/hub-fetch'/.test(br));
  check('P&L BY PERIOD pop-up: ✕ on each categorized line + "Remove category from all N lines listed", asks first; lines LEFT stay listed', /function removeCat\(ids, what\)/.test(ps) && /erApi\('clear_category', \{ ids: list, confirm: true \}\)/.test(ps) && /Remove category from all \{idsX\.length\} lines listed/.test(ps) && /setLeftList\(j\.refused\)/.test(ps) && /\{spCat !== null && leftPanel\(\)\}/.test(ps) && /\{inCat !== null && leftPanel\(\)\}/.test(ps));
  check('PROFITABILITY expense lines: "✕ remove category" in the change-category menu, asks first', /value="__remove__"/.test(pt) && /key === '__remove__'/.test(pt) && /erApi\('clear_category', \{ ids: \[row\.id\], confirm: true \}\)/.test(pt));
  check('NEXTRADE / RTM books: the existing take-off is labelled "✕ remove category" and asks first with the count (server path unchanged)', /✕ remove category \(back to Uncategorized\)/.test(cb) && /if \(!key && !window\.confirm\('Take the category off ' \+ ids\.length/.test(cb));
  check('ROUTE: clear_category is behind the same permission as a pick and passes private scope, history window and the company; a failed check refuses', /action === 'clear_category'/.test(rt) && rt.indexOf("action === 'clear_category'") > rt.indexOf("var gate = await assertPermission(db, userId, 'bank.classify', req)") && /clearCategories\(db, by, body\.payload\.ids, \{ priv: privX, floor: \(winX && winX\.floor\) \|\| null, business: US_WAVE_BUSINESS_ID \}\)/.test(rt) && /privX && privX\.error/.test(rt) && /winX && winX\.error/.test(rt));
  check('words: reasonFor gives a place to fix each association', /Bank Review/.test(C.reasonFor('split')) && /Wires/.test(C.reasonFor('wire')) && /Bills/.test(C.reasonFor('bill')));

  console.log('\nXU: ' + pass + ' passed, ' + failN + ' failed');
  process.exit(failN ? 1 : 0);
})().catch(function (e) { console.error(e); process.exit(1); });
