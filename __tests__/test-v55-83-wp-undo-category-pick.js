// v55.83-WP — Max, 21 Nov 2026: "need to be able to undo a category selection". Runs the REAL category save and the REAL undo
// (expense-rules route: bulk_classify with single_pick, then undo_category_pick) on an in-memory database, following Codex's
// design response of 21 Nov 00:19: exact before / after per row and rule, guarded restores, refuse when the line is in the
// ClickBooks ledger or already sent to Wave, never a silent partial result. All lines are made up.
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
// v55.83-WQ (rebase): the route now acts only for the verified signed-in person — the in-memory test uses the shared stand-in
Module._resolveFilename = function (req) { if (req === '@supabase/supabase-js') { return mockPath; } if (/lib[\/]verified-caller(.js)?$/.test(req)) { return path.join(__dirname, 'helpers', 'stub-verified-caller.js'); } return orig.apply(this, arguments); };
var US = require(path.join(root, 'src/lib/business-of.js')).US_WAVE_BUSINESS_ID;
function tx(id, name, o) { return Object.assign({ id: id, name: name, merchant_name: null, direction: 'out', classification: null, category_source: null, category_verified: false, review_status: 'unreviewed', reviewed_by: null, reviewed_at: null, wave_business_id: US, transfer_group_id: null, pending: false, account_id: 'A1', date: '2026-11-05', amount_abs: 10, amount: -10, wave_account_id: null, wave_account_name: null, category_status: 'local_only', wave_sync_status: 'not_synced', sync_status: 'not_synced' }, o || {}); }
var posted = {}; var rpcOn = true;
function freshDb(extra) {
  posted = {}; rpcOn = true;
  var db = new MemDB({
    users: [{ id: 'u1', role: 'super_admin', name: 'Max' }, { id: 'u2', role: 'super_admin', name: 'Other' }, { id: 'u3', role: 'employee', name: 'No access' }], module_permissions: [],
    expense_categories: [{ key: 'utilities', label: 'Utilities', wave_account_id: 'W-UTIL', wave_account_name: 'Utilities (Wave)' }, { key: 'rent', label: 'Rent' }, { key: 'office', label: 'Office' }, { key: 'transfer', label: 'Transfer' }],
    us_expense_rules: [], hub_audit_log: [], plaid_accounts: [], accounting_invoice_payments: [], bank_transaction_splits: [], bank_unapplied: [], customer_credits: [], wave_categories: [],
    bank_transactions: [
      tx('t1', 'PUBLIC SERVICE ELEC 0001234 NOV'),                                              // the line a person picks
      tx('t2', 'PUBLIC SERVICE ELEC 0009876 DEC'),                                              // blank look-alike
      tx('t3', 'Public Service Elec*Pymt', { classification: 'rent', category_source: 'rule' }), // look-alike set by an OLD rule
      tx('t4', 'PUBLIC SERVICE ELEC 5555', { classification: 'rent', category_source: 'classification' }), // set by a person: never touched
      tx('t5', 'AMAZON MKTPL 12345')
    ].concat(extra || [])
  });
  db.rpc = function (name, args) { if (name === 'hub_bank_ledger_posted') { if (!rpcOn) { return Promise.resolve({ data: null, error: { message: 'function does not exist' } }); } return Promise.resolve({ data: (args.p_ids || []).filter(function (i) { return posted[i]; }), error: null }); } return Promise.resolve({ data: null, error: { message: 'no rpc ' + name } }); };
  global.__db = db; return db;
}
freshDb();
var route = require(path.join(root, 'src/app/api/accounting/expense-rules/route.js'));
var U = require(path.join(root, 'src/lib/category-undo-server.js'));
async function call(body, user) { var res = await route.POST({ json: function () { return Promise.resolve(Object.assign({ user_id: user || 'u1' }, body)); }, headers: { get: function () { return null; } } }); var j = await res.json(); j._status = res.status; return j; }
function row(id) { return global.__db.t.bank_transactions.filter(function (t) { return t.id === id; })[0]; }
function state(id) { var r = row(id); return [r.classification, r.category_source, r.wave_account_id, r.category_status, r.review_status, r.reviewed_by].join('|'); }
function rules() { return global.__db.t.us_expense_rules; }
function pickIt(id, cls, user) { return call({ action: 'bulk_classify', payload: { ids: [id], classification: cls, single_pick: true } }, user); }
function undo(id, user) { return call({ action: 'undo_category_pick', payload: { undo_id: id } }, user); }

(async function () {
  // ── 1. a line with NO category: pick, then undo → exactly as it was
  var s0 = { t1: state('t1'), t2: state('t2'), t3: state('t3'), t4: state('t4'), t5: state('t5') };
  var p1 = await pickIt('t1', 'utilities');
  check('PICK: saved; the line, the blank look-alike and the old-rule look-alike now say Utilities; a rule was learned; an undo id comes back with its time limit', p1.ok === true && row('t1').classification === 'utilities' && row('t2').classification === 'utilities' && row('t3').classification === 'utilities' && row('t4').classification === 'rent' && rules().length === 1 && !!p1.undo_id && p1.undo_hours === 24, p1);
  check('PICK: the Wave category was set on the lines that had none', row('t1').wave_account_id === 'W-UTIL' && row('t2').wave_account_id === 'W-UTIL' && row('t2').category_status === 'pending_wave_sync');
  var pt = global.__db.t.hub_audit_log.filter(function (a) { return a.id === p1.undo_id; })[0];
  check('PICK: the undo point holds the exact BEFORE and AFTER of the line, the rule, and each look-alike’s OWN earlier category (blank for one, Rent-by-rule for the other)', pt && pt.action === 'category_pick_undo_point' && pt.details.line.before.classification === null && pt.details.line.after.classification === 'utilities' && pt.details.rule.how === 'learned' && pt.details.look.length === 2 && pt.details.look.some(function (x) { return x.id === 't2' && x.c === null; }) && pt.details.look.some(function (x) { return x.id === 't3' && x.c === 'rent' && x.s === 'rule'; }), pt && pt.details);
  var u1 = await undo(p1.undo_id);
  check('UNDO: the picked line is back to NO category with every field as before (category, source, Wave, status, review)', u1.ok === true && state('t1') === s0.t1, [u1, state('t1'), s0.t1]);
  check('UNDO: each look-alike is back to ITS OWN earlier state — the blank one blank, the old-rule one Rent by rule (not wiped to blank) — Wave fields too', state('t2') === s0.t2 && state('t3') === s0.t3 && u1.look.restored === 2, [state('t2'), s0.t2, state('t3'), s0.t3]);
  check('UNDO: the person’s own line and the unrelated line were never touched', state('t4') === s0.t4 && state('t5') === s0.t5);
  check('UNDO: the rule this pick created is switched OFF, not deleted', rules().length === 1 && rules()[0].active === false && u1.rule === 'switched_off');
  check('UNDO: the answer says it in plain words', /back to no category/.test(u1.message) && /2 look-alike line\(s\) put back/.test(u1.message) && /rule this pick created is switched off/.test(u1.message), u1.message);
  var u1b = await undo(p1.undo_id);
  check('ONCE ONLY: a second undo of the same pick is refused and changes nothing', u1b.ok === false && u1b._status === 409 && /already undone/.test(u1b.error) && state('t1') === s0.t1 && state('t3') === s0.t3);

  // ── 2. A → B → undo = A, and a rule that already existed goes back to A
  freshDb(); await pickIt('t1', 'rent'); var ruleA = JSON.stringify([rules()[0].classification, rules()[0].active]);
  var sA = { t1: state('t1'), t2: state('t2') };
  var p2 = await pickIt('t1', 'office'); var u2 = await undo(p2.undo_id);
  check('CHANGE OF MIND: Rent → Office → Undo puts the line back to Rent, its look-alike back to Rent, and the rule back to Rent (put back, not switched off)', u2.ok === true && row('t1').classification === 'rent' && state('t1') === sA.t1 && state('t2') === sA.t2 && JSON.stringify([rules()[0].classification, rules()[0].active]) === ruleA && u2.rule === 'put_back' && u2.to === 'rent', [u2, state('t1'), sA.t1, rules()[0]]);

  // ── 3. later work is never overwritten
  freshDb(); var p3 = await pickIt('t1', 'utilities');
  row('t2').classification = 'office'; row('t2').category_source = 'classification';   // a person re-categorized a look-alike
  row('t3').category_verified = true;                                                  // a person verified another
  var u3 = await undo(p3.undo_id);
  check('GUARD: a look-alike a person re-categorized after the pick, and one verified after it, are LEFT as they are and counted; the picked line is still undone', u3.ok === true && row('t1').classification === null && row('t2').classification === 'office' && row('t3').classification === 'utilities' && u3.look.restored === 0 && u3.look.changed_since === 2 && /LEFT as they are/.test(u3.message), u3);
  freshDb(); var p4 = await pickIt('t1', 'utilities'); row('t1').classification = 'office'; var before4 = [state('t2'), state('t3'), JSON.stringify(rules()[0])];
  var u4 = await undo(p4.undo_id);
  check('GUARD: when the PICKED line itself was changed again, the undo is refused and NOTHING is changed (no partial undo)', u4.ok === false && u4._status === 409 && /changed again/.test(u4.error) && row('t1').classification === 'office' && state('t2') === before4[0] && state('t3') === before4[1] && JSON.stringify(rules()[0]) === before4[2], u4);
  freshDb(); var p5 = await pickIt('t1', 'utilities'); rules()[0].classification = 'office'; rules()[0].updated_at = '2030-01-01T00:00:00.000Z';
  var u5 = await undo(p5.undo_id);
  check('GUARD: a rule another person edited after the pick is left alone, and the answer says so', u5.ok === true && rules()[0].classification === 'office' && rules()[0].active !== false && u5.rule === 'changed_since' && /rule was changed by someone since/.test(u5.message), u5);

  // ── 4. ClickBooks ledger and Wave
  freshDb(); var p6 = await pickIt('t1', 'utilities'); posted.t1 = true; var s6 = state('t1');
  var u6 = await undo(p6.undo_id);
  check('LEDGER: a picked line that is already in the ClickBooks ledger is NOT undone — refused with the way to correct it, nothing changed', u6.ok === false && u6._status === 409 && /already in the ClickBooks ledger/.test(u6.error) && /reverse the entry/.test(u6.error) && state('t1') === s6 && row('t2').classification === 'utilities', u6);
  freshDb(); var p7 = await pickIt('t1', 'utilities'); posted.t2 = true; var u7 = await undo(p7.undo_id);
  check('LEDGER: a look-alike already in the ledger is left and counted; the rest is undone', u7.ok === true && row('t1').classification === null && row('t2').classification === 'utilities' && row('t3').classification === 'rent' && u7.look.in_ledger === 1 && u7.look.restored === 1, u7);
  // WS (Codex): no ledger check → NO undo at all, whatever the review status; the pick tells the screen so (no button that fails)
  freshDb(); rpcOn = false; var p8 = await pickIt('t1', 'utilities'); var u8 = await undo(p8.undo_id);
  check('LEDGER CHECK NOT INSTALLED: the pick still saves, gives an undo id but says it is NOT ready; the undo is refused naming the database step; nothing changed', p8.ok === true && !!p8.undo_id && p8.undo_ready === false && u8.ok === false && u8.needs_sql === true && /v55-83-WS-ledger-posted-check\.sql/.test(u8.error) && row('t1').classification === 'utilities' && row('t2').classification === 'utilities', [p8.undo_ready, u8]);
  row('t1').review_status = 'unreviewed'; row('t1').reviewed_by = null; row('t1').reviewed_at = null; var u9 = await undo(p8.undo_id);
  check('LEDGER CHECK NOT INSTALLED: an UNREVIEWED line is refused too — review status is never taken as proof it was not posted', u9.ok === false && u9.needs_sql === true && row('t1').classification === 'utilities');
  rpcOn = true; var p9 = await pickIt('t5', 'office');
  check('LEDGER CHECK INSTALLED: the pick answer says the undo is ready', p9.ok === true && !!p9.undo_id && p9.undo_ready === true, p9);
  freshDb(); var p10 = await pickIt('t1', 'utilities'); row('t1').wave_sync_status = 'synced'; var u10 = await undo(p10.undo_id);
  check('WAVE: a picked line already sent to Wave with the new category is NOT undone — refused, nothing changed', u10.ok === false && /already been sent to Wave/.test(u10.error) && row('t1').classification === 'utilities' && row('t2').classification === 'utilities', u10);
  freshDb(); var p11 = await pickIt('t1', 'utilities'); row('t2').category_status = 'syncing'; var u11 = await undo(p11.undo_id);
  check('WAVE: a look-alike already sent to Wave is left and counted', u11.ok === true && row('t2').classification === 'utilities' && u11.look.sent_to_wave === 1 && row('t3').classification === 'rent', u11);

  // ── WS: Codex's findings on WP
  freshDb(); row('t1').wave_account_id = 'W-UTIL'; row('t1').wave_account_name = 'Utilities (Wave)'; var pW = await pickIt('t1', 'utilities'); row('t1').category_status = 'synced'; var sW = [state('t2'), state('t3'), JSON.stringify(rules()[0])];
  var uW = await undo(pW.undo_id);
  check('CODEX P1: the line ALREADY had its Wave account before the pick, the scheduled sync then sent it — Undo is refused, and nothing (line, look-alikes, rule) is changed', uW.ok === false && /already been sent to Wave/.test(uW.error) && row('t1').classification === 'utilities' && state('t2') === sW[0] && state('t3') === sW[1] && JSON.stringify(rules()[0]) === sW[2], uW);
  freshDb(); row('t3').wave_account_id = 'W-OLD'; var pW2 = await pickIt('t1', 'utilities'); row('t3').wave_sync_status = 'synced'; var uW2 = await undo(pW2.undo_id);
  check('CODEX P1: a look-alike whose Wave account was there before and that was sent since is LEFT and counted as sent to Wave, whoever set its account', uW2.ok === true && row('t3').classification === 'utilities' && uW2.look.sent_to_wave === 1 && row('t1').classification === null, uW2);
  freshDb(); row('t1').category_verified = true; row('t1').category_verified_by = 'u1'; row('t1').category_verified_at = '2026-11-01T00:00:00.000Z'; var pV = await pickIt('t1', 'utilities'); var uV = await undo(pV.undo_id);
  check('CODEX P2: a line that was ALREADY verified before the pick can be undone (the earlier verification is not called new) and stays verified with its own person and time', !!pV.undo_id && uV.ok === true && row('t1').classification === null && row('t1').category_verified === true && row('t1').category_verified_by === 'u1' && row('t1').category_verified_at === '2026-11-01T00:00:00.000Z', uV);
  freshDb(); var pV2 = await pickIt('t1', 'utilities'); row('t1').category_verified = true; row('t1').category_verified_by = 'u2'; row('t1').category_verified_at = '2026-11-21T09:00:00.000Z'; var uV2 = await undo(pV2.undo_id);
  check('CODEX P2: a verification made AFTER the pick blocks the undo, and that verification (person and time) is kept', uV2.ok === false && /verified after your pick/.test(uV2.error) && row('t1').category_verified_by === 'u2' && row('t1').classification === 'utilities', uV2);
  freshDb(); var pP = await pickIt('t1', 'utilities'); row('t1').transfer_group_id = 'G1'; var uP = await undo(pP.undo_id);
  check('CODEX: picked, then paired as a transfer → Undo refused (the same rule as the category save), the pairing and category untouched', uP.ok === false && /paired as a transfer/.test(uP.error) && row('t1').transfer_group_id === 'G1' && row('t1').classification === 'utilities', uP);
  freshDb(); var pR = await pickIt('t1', 'utilities');
  check('CODEX: the real auto-review ran on this fully accounted line — the pick marked it reviewed, stamped by the picker', row('t1').review_status === 'reviewed' && row('t1').reviewed_by === 'u1' && !!row('t1').reviewed_at, [row('t1').review_status, row('t1').reviewed_by]);
  var uR = await undo(pR.undo_id);
  check('CODEX: …the undo puts its review back exactly (status, person and time as before the pick)', uR.ok === true && row('t1').review_status === 'unreviewed' && row('t1').reviewed_by === null && row('t1').reviewed_at === null, [uR, row('t1').review_status, row('t1').reviewed_by]);
  freshDb(); var pR2 = await pickIt('t1', 'utilities'); row('t1').reviewed_by = 'u2'; row('t1').reviewed_at = '2026-11-21T10:00:00.000Z'; var uR2 = await undo(pR2.undo_id);
  check('CODEX: a later reviewer stamp (another person reviewed it after the pick) blocks the undo and is kept', uR2.ok === false && /reviewed again after your pick/.test(uR2.error) && row('t1').reviewed_by === 'u2' && row('t1').classification === 'utilities', uR2);
  // scope, run on the real undo with each check failing in turn
  async function undoWith(scope) { freshDb(); var pS0 = await pickIt('t1', 'utilities'); return { r: await U.undoCategoryPick(global.__db, 'u1', pS0.undo_id, null, scope), cls: row('t1').classification }; }
  var sPriv = await undoWith({ priv: { all: false, hidden: { A1: true } }, business: US }); var sErr = await undoWith({ priv: { error: 'x' }, business: US }); var sBiz = await undoWith({ priv: { all: true }, business: 'OTHER' }); var sWin = await undoWith({ priv: { all: true }, business: US, floor: '2026-11-10' });
  check('SCOPE: a private account the person may not see, a failed private-account check, another company, or a line older than the person’s history window → refused, nothing changed', [sPriv, sErr, sBiz, sWin].every(function (x) { return x.r.ok === false && x.r.status === 403 && x.cls === 'utilities'; }) && /private bank account/.test(sPriv.r.error) && /could not check/.test(sErr.r.error) && /another company/.test(sBiz.r.error) && /older than the history/.test(sWin.r.error), [sPriv.r, sErr.r, sBiz.r, sWin.r]);
  var sOk = await undoWith({ priv: { all: false, hidden: { OTHERACCT: true } }, business: US, floor: '2026-11-01' });
  check('SCOPE: within the person’s accounts, company and window the undo runs', sOk.r.ok === true && sOk.cls === null, sOk.r);
  freshDb(); var pO = await pickIt('t1', 'utilities'); global.__db.t.hub_audit_log.filter(function (a) { return a.id === pO.undo_id; })[0].details.v = 1; var uO1 = await undo(pO.undo_id);
  check('an undo point written by the withdrawn WP build (format 1) is refused in plain words', uO1.ok === false && /before the current undo rules/.test(uO1.error));
  var rtS = fs.readFileSync(path.join(root, 'src/app/api/accounting/expense-rules/route.js'), 'utf8');
  check('ROUTE wiring: the undo passes the person’s private-account scope, history window and the company; a failed private or window check refuses (503)', rtS.indexOf('var privU = await privateScope(db, by);') > 0 && rtS.indexOf('var winU = await windowFloorFor(db, gate.ctx);') > 0 && rtS.indexOf('{ priv: privU, floor: (winU && winU.floor) || null, business: US_WAVE_BUSINESS_ID }') > 0 && /import \{ windowFloorFor \} from '\.\.\/\.\.\/\.\.\/\.\.\/lib\/visibility-window-server'/.test(rtS));
  // ── Codex 08:28 P2: an undo that stops half-way keeps its Undo button, decided from the answer's shape, never its words
  freshDb(); var pH = await pickIt('t1', 'utilities'); var realFrom = global.__db.from.bind(global.__db); var failLook = true;
  global.__db.from = function (tbl) { var q = realFrom(tbl); if (tbl !== 'bank_transactions') { return q; } var sel = q.select.bind(q); q.select = function (cols) { if (failLook && cols === U.LOOK_COLS) { var bad = { in: function () { return bad; }, then: function (ok) { return Promise.resolve({ data: null, error: { message: 'statement timeout' } }).then(ok); } }; return bad; } return sel(cols); }; return q; };
  var uH = await undo(pH.undo_id);
  check('PARTIAL (real route): the picked line is put back, the look-alikes could not be read → the answer says retryable and partial, with the route marker; look-alikes not touched', uH.ok === false && uH.retryable === true && uH.partial === true && !!uH.api_build_marker && row('t1').classification === null && row('t2').classification === 'utilities', uH);
  failLook = false; var uH2 = await undo(pH.undo_id);
  check('RETRY (real route): the same undo id finishes the rest — look-alikes back, rule off, the line not touched twice', uH2.ok === true && uH2.line === 'already_back' && row('t2').classification === null && row('t3').classification === 'rent' && rules()[0].active === false, uH2);
  global.__db.from = realFrom;
  var B = require(path.join(root, 'src/lib/undo-bar-state.js'));
  check('BAR RULE: kept for a retryable answer and for no server answer at all; hidden for a final refusal and for success — whatever the words say', B.keepUndoBar(uH) === true && B.keepUndoBar({ ok: false, error: 'Could not reach the server (network).' }) === true && B.keepUndoBar(null) === true && B.keepUndoBar({ ok: false, error: 'This line was changed again — try again', api_build_marker: 'x' }) === false && B.keepUndoBar({ ok: true, api_build_marker: 'x' }) === false && B.undoChangedSomething(uH) === true && B.undoChangedSomething({ ok: false, api_build_marker: 'x' }) === false);
  // the REAL undoPick handler of each screen, taken from its source and run with stand-ins for its state and helpers
  function runHandler(file, apiName, reloadCall, answers) {
    var src = fs.readFileSync(path.join(root, 'src/components/' + file + '.jsx'), 'utf8'); var m = src.match(/function undoPick\(\) \{[^\n]*\n/); if (!m) { return { error: 'handler not found' }; }
    var st = { pt: { id: 'U1' }, busy: false, reloads: 0, toasts: [], calls: 0 }; var queue = answers.slice();
    var env = { setUndoBusy: function (v) { st.busy = v; }, setUndoPt: function (v) { st.pt = v; }, toast: { success: function (t) { st.toasts.push('ok:' + t); }, error: function (t) { st.toasts.push('err:' + t); } }, keepUndoBar: B.keepUndoBar, undoChangedSomething: B.undoChangedSomething };
    env[apiName] = function (action, payload) { st.calls++; st.lastPayload = payload; return Promise.resolve(queue.shift()); };
    var reloadName = reloadCall.split('(')[0]; env[reloadName] = function () { st.reloads++; };
    var names = Object.keys(env); var body = 'var undoPt = st.pt; var undoBusy = st.busy; ' + m[0] + ' return undoPick;';
    var make = new Function(['st'].concat(names).join(','), body.replace('var undoPt = st.pt; var undoBusy = st.busy; ', ''));
    return { st: st, run: function () { var f = new Function(['st'].concat(names).join(','), 'var undoPt = st.pt; var undoBusy = st.busy; ' + m[0] + ' return undoPick();'); return f.apply(null, [st].concat(names.map(function (n) { return env[n]; }))); } };
  }
  var SCREENS = [['ProfitabilityTab', 'erApi', 'startExpenses({ ignoreCache: true })'], ['PeriodStatsTab', 'erApi', 'load(from, to)'], ['AllTransactionsTab', 'api', 'quietReload()']];
  for (var si = 0; si < SCREENS.length; si++) {
    var sc = SCREENS[si];
    if (sc[0] === 'PeriodStatsTab') { global.from = '2026-01-01'; global.to = '2026-12-31'; }
    var h = runHandler(sc[0], sc[1], sc[2], [uH, Object.assign({}, uH2, { api_build_marker: 'x', message: 'Undone.' })]);
    if (h.error) { check('HANDLER ' + sc[0] + ' found', false, h.error); continue; }
    await h.run(); await new Promise(function (r) { setTimeout(r, 0); });
    var afterPartial = { pt: h.st.pt, reloads: h.st.reloads, busy: h.st.busy };
    await h.run(); await new Promise(function (r) { setTimeout(r, 0); });
    check('HANDLER ' + sc[0] + ' (real code): a half-finished undo KEEPS the Undo bar with the same undo id and reloads the screen; pressing Undo again sends that same id, finishes, and then the bar goes', afterPartial.pt && afterPartial.pt.id === 'U1' && afterPartial.reloads === 1 && afterPartial.busy === false && h.st.calls === 2 && h.st.lastPayload.undo_id === 'U1' && h.st.pt === null && h.st.reloads === 2, [afterPartial, h.st]);
    var hf = runHandler(sc[0], sc[1], sc[2], [{ ok: false, error: 'This line was changed again after your pick — try again later', api_build_marker: 'x' }]);
    await hf.run(); await new Promise(function (r) { setTimeout(r, 0); });
    check('HANDLER ' + sc[0] + ' (real code): a FINAL refusal hides the bar even when its words say “try again” (no text matching)', hf.st.pt === null && hf.st.reloads === 0);
  }
  var srcs = ['ProfitabilityTab', 'PeriodStatsTab', 'AllTransactionsTab'].map(function (f) { return fs.readFileSync(path.join(root, 'src/components/' + f + '.jsx'), 'utf8'); });
  check('no screen decides by matching English words any more', srcs.every(function (x) { return x.indexOf('try again|reach the server|did not answer') < 0 && /import \{ keepUndoBar, undoChangedSomething \} from '\.\.\/lib\/undo-bar-state'/.test(x); }));
  // ── 5. who and when
  freshDb(); var p12 = await pickIt('t1', 'utilities');
  var uO = await undo(p12.undo_id, 'u2'); var uN = await undo(p12.undo_id, 'u3');
  check('WHO: another person cannot undo it; a person without the category permission cannot either; nothing changed', uO.ok === false && uO._status === 403 && /Only the person who picked/.test(uO.error) && uN.ok === false && (uN._status === 403 || uN.denied === true) && row('t1').classification === 'utilities', [uO, uN]);
  var pt12 = global.__db.t.hub_audit_log.filter(function (a) { return a.id === p12.undo_id; })[0]; pt12.created_at = new Date(Date.now() - 25 * 3600000).toISOString();
  var uT = await undo(p12.undo_id);
  check('WHEN: after 24 hours the undo is refused in plain words; nothing changed', uT.ok === false && /more than 24 hours ago/.test(uT.error) && row('t1').classification === 'utilities', uT);
  var uX = await undo('no-such-id'); var uE = await undo('');
  check('an unknown or empty undo id is refused', uX.ok === false && uE.ok === false);

  // ── 6. what gets NO undo
  freshDb(); var b1 = await call({ action: 'bulk_classify', payload: { ids: ['t1', 't2'], classification: 'rent' } });
  check('a BULK pick (several lines) gets no undo id — out of scope for this build', b1.ok === true && !b1.undo_id && global.__db.t.hub_audit_log.filter(function (a) { return a.action === 'category_pick_undo_point'; }).length === 0, b1);
  freshDb(); var same1 = await pickIt('t4', 'rent');
  check('picking the category a line already has changes nothing, so no undo is offered', same1.ok === true && (!same1.undo_id || row('t4').category_source === 'classification'));

  // ── 7. resume: the line went back, the rest did not (a first attempt that stopped half-way)
  freshDb(); var p13 = await pickIt('t1', 'utilities'); var d13 = global.__db.t.hub_audit_log.filter(function (a) { return a.id === p13.undo_id; })[0].details.line.before;
  Object.keys(d13).forEach(function (k) { row('t1')[k] = d13[k]; });
  var u13 = await undo(p13.undo_id);
  check('RETRY: when a first attempt already put the line back, a retry finishes the look-alikes and the rule instead of failing or doing it twice', u13.ok === true && u13.line === 'already_back' && row('t2').classification === null && row('t3').classification === 'rent' && rules()[0].active === false, u13);

  // ── revision 2: only columns that exist on the LIVE table (the first build read a column that is not there)
  var LIVE = 'id, connection_id, plaid_transaction_id, date, amount, name, merchant_name, category, pending, account_id, matched_invoice_id, matched_at, created_at, business_id, bank_source, posted_date, authorized_date, direction, amount_abs, iso_currency, check_number, channel, transaction_code, classification, review_status, linked_type, linked_id, customer_id, notes, pending_transaction_id, raw, reviewed_by, reviewed_at, updated_at, created_by, updated_by, account_type, account_subtype, unsupported_account, accounting_customer_id, wave_category_id, wave_sync_status, sync_status, wave_business_id, wave_category_name, wave_account_id, wave_account_name, hub_category, category_source, wave_category_locked, wave_category_is_uncategorized, wave_account_type, wave_account_subtype, category_status, category_verified, category_verified_by, category_verified_at, transfer_group_id, third_party_payer, advance_flag, company_category, company_category_source, company_category_by, company_category_at'.split(', ');
  var libSrc = fs.readFileSync(path.join(root, 'src/lib/category-undo-server.js'), 'utf8');
  check('LIVE COLUMNS: every bank-line column the undo reads or filters on exists on the live table (the live column list of 21 Nov 2026); wave_transaction_id is not used anywhere in the undo', U.LINE_COLS.split(', ').concat(U.LOOK_COLS.split(', ')).every(function (c) { return LIVE.indexOf(c) >= 0; }) && libSrc.indexOf("'wave_transaction_id'") < 0 && !/wave_transaction_id[^.\n]*\)/.test(libSrc.replace(/\/\/[^\n]*/g, '')), U.LINE_COLS);
  // a database that REFUSES an unknown column, like the live one: the pick must still get its undo point and the undo must still work
  freshDb(); var strict = global.__db; var realFrom = strict.from.bind(strict); var badCol = null;
  strict.from = function (tbl) { var q = realFrom(tbl); if (tbl !== 'bank_transactions') { return q; } var sel = q.select.bind(q); q.select = function (cols) { String(cols || '').split(',').forEach(function (c) { c = c.trim(); if (c && c !== '*' && LIVE.indexOf(c) < 0) { badCol = c; } }); return sel(cols); }; return q; };
  var pS = await pickIt('t1', 'utilities'); var uS = pS.undo_id ? await undo(pS.undo_id) : { ok: false };
  check('LIVE COLUMNS: through the whole pick and undo, no bank-line read by the undo code names a column the live table lacks; the pick got its undo id and the undo restored the line', !!pS.undo_id && uS.ok === true && row('t1').classification === null && (badCol === null || badCol === 'wave_transaction_id'), [badCol, pS.undo_id, uS]);
  check('SENT TO WAVE is read from the line’s own sync fields (synced or syncing), not from a column that does not exist', U.sentToWave({ category_status: 'synced' }) && U.sentToWave({ wave_sync_status: 'syncing' }) && U.sentToWave({ sync_status: 'synced' }) && !U.sentToWave({ category_status: 'local_only', wave_sync_status: 'not_synced', sync_status: 'not_synced' }) && !U.sentToWave({ category_status: 'pending_wave_sync' }) && !U.sentToWave({}));
  // ── words and screens
  check('WORDS: a failed undo shows the server’s own reason; a clean one names the category', U.undoWords({ ok: false, error: 'x' }) === 'x' && U.undoWords({ ok: true, to: 'rent', look: {}, rule: 'none' }, function () { return 'Rent'; }) === 'Undone: the line is back to Rent.');
  var React = require('react'); global.React = React; var RS = require('react-dom/server'); var Bar = require(path.join(root, 'src/components/UndoPickBar.jsx')).default;
  var html = RS.renderToStaticMarkup(React.createElement(Bar, { point: { id: 'x', who: 'PUBLIC SERVICE ELEC', label: 'Utilities', hours: 24 } })); var clicked = 0;
  check('SCREEN: the bar says what was set, what Undo puts back, the 24 hours, and has a real Undo button; no undo point → no bar', html.indexOf('Category set to Utilities for “PUBLIC SERVICE ELEC”') > 0 && html.indexOf('↶ Undo') > 0 && html.indexOf('Offered for 24 hours') > 0 && RS.renderToStaticMarkup(React.createElement(Bar, { point: null })) === '', html);
  var el = Bar({ point: { id: 'x' }, onUndo: function () { clicked++; } }); var kids = [].concat(el.props ? el.props.children : []); kids.filter(function (k) { return k && k.type === 'button'; })[0].props.onClick({ stopPropagation: function () {} });
  check('SCREEN: clicking Undo calls the undo once', clicked === 1);
  ['ProfitabilityTab', 'PeriodStatsTab', 'AllTransactionsTab'].forEach(function (f) { var src = fs.readFileSync(path.join(root, 'src/components/' + f + '.jsx'), 'utf8');
    check('SCREEN ' + f + ': imports the bar, keeps the undo id from the save, calls undo_category_pick and shows the bar', /import UndoPickBar from '\.\/UndoPickBar'/.test(src) && src.indexOf('setUndoPt(j.undo_id ? { id: j.undo_id') > 0 && src.indexOf("('undo_category_pick', { undo_id: undoPt.id })") > 0 && src.indexOf('<UndoPickBar point={undoPt} busy={undoBusy} onUndo={undoPick}') > 0); });
  var lib = fs.readFileSync(path.join(root, 'src/lib/category-undo-server.js'), 'utf8'); var sql = fs.readFileSync(path.join(root, 'sql/v55-83-WS-ledger-posted-check.sql'), 'utf8');
  check('server style: no backticks, arrow functions, let / const in the undo code; the SQL has no comment lines, is read-only, service role only', lib.indexOf(String.fromCharCode(96)) < 0 && !/=>/.test(lib) && !/\b(let|const)\s/.test(lib) && !/^\s*--/m.test(sql) && !/\b(insert|update|delete|drop|alter)\b/i.test(sql.replace(/security definer|set search_path/gi, '')) && /grant execute on function public\.hub_bank_ledger_posted\(text\[\]\) to service_role/.test(sql) && /revoke all .* from anon/.test(sql));
  console.log('\nWP: ' + pass + ' passed, ' + failN + ' failed');
  if (failN) { process.exit(1); }
})().catch(function (err) { console.log('  ✗ FAIL: threw ' + ((err && err.stack) || err)); process.exit(1); });
