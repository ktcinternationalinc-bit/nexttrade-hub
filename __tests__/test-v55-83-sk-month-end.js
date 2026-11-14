// ═══════════════════════════════════════════════════════════════════════════
// v55.83-SK — accounting priority 2. Max, Nov 13 12:50: "we should be able to reconcile things at month-end ... We should
//  probably create something for the bank reconciliation" · 12:52: "work on top 2 right now, top 3, and let's move forward."
// Reconcile each bank account to its statement, then the super admin closes (locks) the month. Nothing is ever adjusted to
// force a match. The SQL ran on local PG16 with the real ClickBooks core (clickbooks/tests/qz2-ledger-drift/15_sk.sql):
// wrong statement → difference shown, close refused naming the account; right statement → reconciled; mid-month / unfinished
// month / already-closed refused; closed → the ledger refuses an entry dated in it (CB_PERIOD_LOCKED) and the 15-minute job
// still runs; reconciliation rows are append-only; reopen needs a reason; trial balance nets to zero.
// Here: the API route is run for real (identity + bank-balance permission mocked at the session boundary).
// ═══════════════════════════════════════════════════════════════════════════
var path = require('path'); var Module = require('module'); var fs = require('fs');
var root = path.join(__dirname, '..');
process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-anon-key';
require(path.join(root, 'node_modules/sucrase/register'));
var R = function (p) { return fs.readFileSync(path.join(root, p), 'utf8'); };
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra || '').substring(0, 600))); }
console.log('SK — month-end: reconcile to the statement, then close');
(async function () {
  var realPath = path.join(root, 'src/lib/bank-visibility.js');
  var stubPath = path.join(__dirname, 'helpers', 'stub-bank-visibility-sk.js');
  fs.writeFileSync(stubPath, 'var real = require(' + JSON.stringify(realPath) + ');\nmodule.exports = Object.assign({}, real, { authorizeBankVisibility: function () { if (!global.__skAccess) { throw new real.BankVisibilityError("Sign in to use bank data.", 401); } return Promise.resolve(global.__skAccess); } });\n');
  var orig = Module._resolveFilename;
  Module._resolveFilename = function (req, parent) { if (/lib\/bank-visibility\.js$/.test(req) && parent && /month-end/.test(parent.filename || '')) { return stubPath; } return orig.apply(this, arguments); };
  var calls = [];
  var db = { rpc: function (name, args) { calls.push({ name: name, args: args });
    if (name === 'clickbooks_us_recon_overview') { return Promise.resolve({ data: { installed: true, date: args.p_date, locked_through: null, accounts: [{ account_id: 'a0000000-0000-0000-0000-000000000001', code: '1010', name: 'Chase ••6338', ledger: 125743.45, has_activity: true, reconciled: false }] }, error: null }); }
    if (name === 'clickbooks_us_recon_save') { var diff = Math.round((args.p_statement - 125743.45) * 100) / 100; return Promise.resolve({ data: { ok: true, reconciled: diff === 0, statement: args.p_statement, ledger: 125743.45, difference: diff }, error: null }); }
    if (name === 'clickbooks_us_close_period') { return args.p_through === '2026-10-31' ? Promise.resolve({ data: { ok: true, locked_through: args.p_through }, error: null }) : Promise.resolve({ data: null, error: { message: 'Cannot close ' + args.p_through + ': Chase ••6338 — not reconciled yet; ' } }); }
    if (name === 'clickbooks_us_reopen_period') { return Promise.resolve({ data: { ok: true, locked_through: args.p_to, was: '2026-10-31' }, error: null }); }
    return Promise.resolve({ data: null, error: { message: 'Could not find the function public.' + name + ' in the schema cache' } }); } };
  var route = require(path.join(root, 'src/app/api/accounting/month-end/route.js'));
  async function call(access, body) { global.__skAccess = access; var txt = JSON.stringify(body);
    var res = await route.POST({ method: 'POST', headers: { get: function (k) { return k === 'content-length' ? String(txt.length) : null; } }, text: function () { return Promise.resolve(txt); } }); return res.json(); }
  var viewer = { db: db, authUserId: 'aaaaaaaa-0000-0000-0000-000000000001', canViewBankBalances: true, isVerifiedSuperAdmin: false };
  var boss = { db: db, authUserId: 'aaaaaaaa-0000-0000-0000-000000000009', canViewBankBalances: true, isVerifiedSuperAdmin: true };
  var nobody = { db: db, authUserId: 'aaaaaaaa-0000-0000-0000-000000000003', canViewBankBalances: false, isVerifiedSuperAdmin: false };
  var n0 = await call(null, { action: 'overview', date: '2026-10-31' });
  check('1: not signed in → refused', n0.ok === false && /Sign in/.test(n0.error), n0);
  var n1 = await call(nobody, { action: 'overview', date: '2026-10-31' });
  check('2: bank balances are shown here → a person without “see bank balances” is refused, and the ledger is never asked', n1.ok === false && /see bank balances/.test(n1.error) && calls.length === 0, n1);
  var o1 = await call(viewer, { action: 'overview', date: '2026-10-31' });
  check('3: a permitted person sees each bank account’s ledger balance for the date; only the super admin is offered Close', o1.ok && o1.accounts[0].ledger === 125743.45 && o1.can_close === false && (await call(boss, { action: 'overview', date: '2026-10-31' })).can_close === true, o1);
  var s0 = await call(viewer, { action: 'save', account_id: 'a0000000-0000-0000-0000-000000000001', date: '2026-10-31', statement: 'about 125k' });
  check('4: the statement balance must be a number', !s0.ok && /as a number/.test(s0.error), s0);
  var s1 = await call(viewer, { action: 'save', account_id: 'a0000000-0000-0000-0000-000000000001', date: '2026-10-31', statement: '$125,843.45' });
  check('5: a statement that differs is SAVED AS A DIFFERENCE ($100.00) — never adjusted; "$" and commas are accepted', s1.ok && s1.reconciled === false && s1.difference === 100 && calls[calls.length - 1].args.p_statement === 125843.45, s1);
  var s2 = await call(viewer, { action: 'save', account_id: 'a0000000-0000-0000-0000-000000000001', date: '2026-10-31', statement: '125743.45' });
  check('6: a statement that agrees to the cent → reconciled; the verified sign-in (not a browser-sent id) is recorded', s2.ok && s2.reconciled === true && calls[calls.length - 1].args.p_actor === viewer.authUserId, s2);
  var c0 = await call(viewer, { action: 'close', through: '2026-10-31' });
  check('7: only the super admin closes a month', !c0.ok && /Only the super admin/.test(c0.error), c0);
  var c1 = await call(boss, { action: 'close', through: '2026-09-30' });
  check('8: the ledger’s refusal is shown as is (which account is not reconciled)', !c1.ok && /Chase ••6338 — not reconciled yet/.test(c1.error), c1);
  var c2 = await call(boss, { action: 'close', through: '2026-10-31' });
  check('9: the super admin closes the month', c2.ok && c2.locked_through === '2026-10-31', c2);
  var r0 = await call(boss, { action: 'reopen', reason: 'oops' }); var r1 = await call(viewer, { action: 'reopen', reason: 'accountant found a missing entry' }); var r2 = await call(boss, { action: 'reopen', reason: 'accountant found a missing entry' });
  check('10: reopening needs the super admin and a written reason', !r0.ok && /at least 10/.test(r0.error) && !r1.ok && r2.ok && calls[calls.length - 1].args.p_reason === 'accountant found a missing entry', { r0: r0, r1: r1, r2: r2 });

  var Q = R('sql/v55-83-SK-reconcile-close.sql');
  check('11: SQL: reconciled means equal to the cent (a database rule), rows are append-only, and nothing adjusts a balance',
    Q.indexOf('CHECK (reconciled = (difference_cents = 0))') > 0 && Q.indexOf('CREATE TRIGGER cb_us_recon_append_only BEFORE UPDATE OR DELETE') > 0 && Q.indexOf('post_journal') < 0);
  check('12: SQL: a month closes only at its last day, when it is over, and when every bank account with activity agrees with its statement NOW',
    Q.indexOf("A month is closed at its last day") > 0 && Q.indexOf("That month is not over yet.") > 0 && Q.indexOf("elsif rec.statement_cents <> led then") > 0 && Q.indexOf("update clickbooks_us.books set locked_through = p_through") > 0);
  check('13: SQL is additive (no existing ledger function redefined) and service-role only', !/create or replace function clickbooks_us\.(deposit_lines|has_piecewise|affbill_lines|shadow_sync_run|drift_sync_run|classified_sync_run)/.test(Q) && Q.indexOf('REVOKE ALL ON FUNCTION public.clickbooks_us_close_period(date, uuid) FROM public, anon, authenticated;') > 0);
  var U = R('src/components/MonthEndTab.jsx'); var AT = R('src/components/AccountingTab.jsx');
  check('14: screen: 📅 Month-end under REPORTS · MONEY & CASH; white panel, explicit dark text, no pop-ups; sends the signed-in session, never a typed user id',
    AT.indexOf("['period_stats', 'forecast', 'monthend']") > 0 && AT.indexOf("{sub === 'monthend' && <div className=\"p-3\"><MonthEndTab /></div>}") > 0 && U.indexOf("bankSessionHeaders(supabase, true)") > 0 && U.indexOf('user_id') < 0 &&
    !/window\.(alert|confirm|prompt)/.test(U) && !/className="[^"]*\b(bg-white|text-white|text-slate-|text-gray-)/.test(U));
  var M = require(path.join(root, 'src/components/MonthEndTab.jsx'));
  check('15: the screen opens on the last finished month-end', M.lastMonthEnd('2026-11-13') === '2026-10-31' && M.lastMonthEnd('2026-03-01') === '2026-02-28' && M.lastMonthEnd('2027-01-15') === '2026-12-31');
  check('16: the ledger scenario file is in the repo', fs.existsSync(path.join(root, 'clickbooks/tests/qz2-ledger-drift/15_sk.sql')));
  console.log('\n' + pass + ' passed, ' + failN + ' failed'); if (failN) { process.exit(1); }
})().catch(function (e) { console.error(e); process.exit(1); });
