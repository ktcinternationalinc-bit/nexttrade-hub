// ═══════════════════════════════════════════════════════════════════════════
// v55.83-SL — accounting priority 3. Max, Nov 13 12:50: "we should be able to do a journal entry. I agree."
//  · 12:52: "work on top 2 right now, top 3, and let's move forward."
// One person writes the entry, a DIFFERENT person approves it, then it is in the ledger. Never edited — reversed.
// The SQL ran on local PG16 with the real ClickBooks core (clickbooks/tests/qz2-ledger-drift/16_sl.sql): unbalanced / bank
// account / receivable control / future date / before the opening balance / no description → refused; a good entry is NOT in
// the ledger until approved; the writer cannot approve; a request cannot be edited; a second person approves → posted;
// approving twice refused; reject needs a reason; only the writer cancels; a month closed after writing → approval refused;
// reversal = a linked new entry approved the same way → nets to zero; trial balance nets to zero.
// Here: the API route is run for real (identity mocked at the session boundary; permissions from the real permission code).
// ═══════════════════════════════════════════════════════════════════════════
var path = require('path'); var Module = require('module'); var fs = require('fs');
var root = path.join(__dirname, '..');
process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'x';
require(path.join(root, 'node_modules/sucrase/register'));
var MemDB = require('./helpers/memdb-wires.js');
var R = function (p) { return fs.readFileSync(path.join(root, p), 'utf8'); };
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra || '').substring(0, 600))); }
console.log('SL — journal entries: one writes, another approves');
(async function () {
  var realPath = path.join(root, 'src/lib/bank-visibility.js');
  var stubPath = path.join(__dirname, 'helpers', 'stub-bank-visibility-sl.js');
  fs.writeFileSync(stubPath, 'var real = require(' + JSON.stringify(realPath) + ');\nmodule.exports = Object.assign({}, real, { authorizeBankVisibility: function () { if (!global.__slAccess) { throw new real.BankVisibilityError("Sign in to use bank data.", 401); } return Promise.resolve(global.__slAccess); } });\n');
  var mockPath = path.join(__dirname, 'helpers', 'mock-supabase-js.js');
  fs.writeFileSync(mockPath, 'module.exports={createClient:function(){return global.__db;}};');
  var orig = Module._resolveFilename;
  Module._resolveFilename = function (req, parent) { if (req === '@supabase/supabase-js') { return mockPath; } if (/lib\/bank-visibility\.js$/.test(req) && parent && /journal-entries/.test(parent.filename || '')) { return stubPath; } return orig.apply(this, arguments); };
  var db = new MemDB({ users: [{ id: 'p-writer', name: 'Wendy Writer', role: 'staff', active: true }, { id: 'p-appr', name: 'Adam Approver', role: 'staff', active: true }, { id: 'p-none', name: 'Nora None', role: 'staff', active: true }],
    module_permissions: [{ user_id: 'p-writer', module_name: 'journals.prepare', has_access: true }, { user_id: 'p-appr', module_name: 'journals.approve', has_access: true }] });
  var reqs = []; var calls = [];
  db.rpc = function (name, a) { calls.push({ name: name, args: a });
    if (name === 'clickbooks_us_mj_list') { return Promise.resolve({ data: reqs, error: null }); }
    if (name === 'clickbooks_us_mj_accounts') { return Promise.resolve({ data: [{ id: 'c0000000-0000-0000-0000-000000000001', code: '6000', name: 'Office', type: 'expense' }], error: null }); }
    if (name === 'clickbooks_us_mj_create') { var d = 0; var c = 0; a.p_lines.forEach(function (l) { d += l.debit_cents; c += l.credit_cents; });
      if (d !== c) { return Promise.resolve({ data: null, error: { message: 'The entry does not balance: debits 100.00 and credits 90.00 differ by 10.00.' } }); }
      var r = { id: 'd0000000-0000-0000-0000-00000000000' + (reqs.length + 1), status: 'pending', created_by: a.p_actor, created_by_name: a.p_actor_name, lines: a.p_lines }; reqs.push(r); return Promise.resolve({ data: { ok: true, id: r.id, total: d / 100 }, error: null }); }
    if (name === 'clickbooks_us_mj_decide') { var q = reqs.filter(function (x) { return x.id === a.p_id; })[0];
      if (q.created_by === a.p_actor) { return Promise.resolve({ data: null, error: { message: 'A second person has to approve or reject it — not the person who wrote it.' } }); }
      q.status = a.p_approve ? 'approved' : 'rejected'; return Promise.resolve({ data: { ok: true, status: q.status }, error: null }); }
    if (name === 'clickbooks_us_mj_cancel') { return Promise.resolve({ data: { ok: true, status: 'cancelled' }, error: null }); }
    return Promise.resolve({ data: null, error: { message: 'Could not find the function public.' + name + ' in the schema cache' } }); };
  global.__db = db;
  var route = require(path.join(root, 'src/app/api/accounting/journal-entries/route.js'));
  function acc(profile, auth, boss) { return { db: db, profileId: profile, authUserId: auth, isVerifiedSuperAdmin: boss === true, canViewBankBalances: false }; }
  async function call(access, body) { global.__slAccess = access; var txt = JSON.stringify(body);
    var res = await route.POST({ method: 'POST', headers: { get: function (k) { return k === 'content-length' ? String(txt.length) : null; } }, text: function () { return Promise.resolve(txt); } }); return res.json(); }
  var W = acc('p-writer', 'aaaaaaaa-0000-0000-0000-00000000000a'); var A = acc('p-appr', 'aaaaaaaa-0000-0000-0000-00000000000b'); var N = acc('p-none', 'aaaaaaaa-0000-0000-0000-00000000000c'); var BOSS = acc('p-none', 'aaaaaaaa-0000-0000-0000-000000000009', true);
  var ACC1 = 'c0000000-0000-0000-0000-000000000001'; var ACC2 = 'c0000000-0000-0000-0000-000000000002';
  var n0 = await call(N, { action: 'list' });
  check('1: no Journals switch → refused, the ledger is never asked', !n0.ok && /Journals: write/.test(n0.error) && calls.length === 0, n0);
  var l0 = await call(W, { action: 'list' });
  check('2: the writer sees the list and the accounts; can write, cannot approve', l0.ok && l0.can_write === true && l0.can_approve === false && l0.accounts.length === 1 && l0.me === W.authUserId, l0);
  var c0 = await call(A, { action: 'create', date: '2026-11-05', description: 'Accrue rent', lines: [] });
  check('3: someone with only "approve" cannot write', !c0.ok && /Journals: write/.test(c0.error), c0);
  var c1 = await call(W, { action: 'create', date: '2026-11-05', description: 'Accrue rent', lines: [{ account_id: ACC1, debit: 'lots', credit: '' }, { account_id: ACC2, debit: '', credit: '100' }] });
  check('4: amounts must be numbers; the line is named', !c1.ok && /Line 1: amounts are numbers/.test(c1.error), c1);
  var c2 = await call(W, { action: 'create', date: '2026-11-05', description: 'Accrue rent', lines: [{ account_id: ACC1, debit: '100', credit: '' }, { account_id: ACC2, debit: '', credit: '90' }] });
  check('5: an unbalanced entry is refused by the ledger, in plain words', !c2.ok && /does not balance/.test(c2.error), c2);
  var c3 = await call(W, { action: 'create', date: '2026-11-05', description: 'Accrue November rent', lines: [{ account_id: ACC1, debit: '$1,250.50', credit: '' }, { account_id: '', debit: '', credit: '' }, { account_id: ACC2, debit: '', credit: '1250.5' }] });
  var sent = calls[calls.length - 1].args;
  check('6: a good entry is sent for approval: exact cents, empty rows dropped, the verified sign-in and name recorded', c3.ok && c3.total === 1250.5 && sent.p_lines.length === 2 && sent.p_lines[0].debit_cents === 125050 && sent.p_actor === W.authUserId && sent.p_actor_name === 'Wendy Writer', { c3: c3, sent: sent });
  var a0 = await call(W, { action: 'approve', id: reqs[0].id });
  check('7: the writer cannot approve (no approve switch)', !a0.ok && /Journals: approve/.test(a0.error) && reqs[0].status === 'pending', a0);
  var b0 = await call(BOSS, { action: 'create', date: '2026-11-06', description: 'Boss entry', lines: [{ account_id: ACC1, debit: '5', credit: '' }, { account_id: ACC2, debit: '', credit: '5' }] });
  var b1 = await call(BOSS, { action: 'approve', id: reqs[1].id });
  check('8: even the super admin cannot approve an entry he wrote himself', b0.ok && !b1.ok && /second person/.test(b1.error) && reqs[1].status === 'pending', b1);
  var r0 = await call(A, { action: 'reject', id: reqs[1].id, note: '' });
  check('9: rejecting needs a reason', !r0.ok && /why it is rejected/.test(r0.error), r0);
  var a1 = await call(A, { action: 'approve', id: reqs[0].id });
  check('10: a different person approves → posted', a1.ok && a1.status === 'approved' && reqs[0].status === 'approved', a1);

  var Q = R('sql/v55-83-SL-journal-entries.sql');
  check('11: SQL: the two-person rule is a database rule, and a decided request never changes', Q.indexOf('decided_by IS NOT NULL AND decided_by <> created_by') > 0 && Q.indexOf("if r.created_by = p_actor then raise exception 'A second person has to approve or reject it") > 0 && Q.indexOf('CB_IMMUTABLE: this journal entry request was already') > 0);
  check('12: SQL: posts through the ledger’s own post_journal (balanced, month not closed, approved accounts) and re-checks at approval', Q.indexOf("jid := clickbooks_us.post_journal(r.book_id, r.entry_date") > 0 && Q.indexOf('perform clickbooks_us.mj_check(r.book_id, r.entry_date, r.lines);') > 0);
  check('13: SQL: bank accounts and the receivable / payable / transfer control accounts cannot be used', Q.indexOf("and not a.is_bank_sensitive and a.code not in ('1090', '1100', '2000')") > 0);
  check('14: SQL is additive and service-role only', !/create or replace function clickbooks_us\.(deposit_lines|has_piecewise|affbill_lines|shadow_sync_run|post_journal|reverse_journal)\b/.test(Q) && Q.indexOf('REVOKE ALL ON FUNCTION public.clickbooks_us_mj_decide(uuid, boolean, text, uuid, text) FROM public, anon, authenticated;') > 0);
  var J = require(path.join(root, 'src/components/JournalEntriesTab.jsx'));
  var t1 = J.entryTotals([{ debit: '1,250.50', credit: '' }, { debit: '', credit: '$1250.5' }]); var t2 = J.entryTotals([{ debit: '0.10', credit: '' }, { debit: '0.20', credit: '' }, { debit: '', credit: '0.30' }]); var t3 = J.entryTotals([{ debit: '100', credit: '' }, { debit: '', credit: '90' }]);
  check('15: the screen’s running totals are exact to the cent (0.10 + 0.20 = 0.30) and say when it is off', t1.balanced && t1.debit === 125050 && t2.balanced && !t3.balanced && t3.diff === 1000 && !J.entryTotals([]).balanced, { t1: t1, t2: t2, t3: t3 });
  var U = R('src/components/JournalEntriesTab.jsx'); var AT = R('src/components/AccountingTab.jsx'); var BP = R('src/components/BankingAccessPanel.jsx');
  check('16: screen: ✍️ Journal entries under REPORTS · LEDGER; signed-in session only; white panel, explicit dark text, no pop-ups', AT.indexOf("['clickbooks_reports', 'journals']") > 0 && AT.indexOf("{sub === 'journals' && <div className=\"p-3\"><JournalEntriesTab /></div>}") > 0 &&
    U.indexOf('bankSessionHeaders(supabase, true)') > 0 && U.indexOf('user_id') < 0 && !/window\.(alert|confirm|prompt)/.test(U) && !/className="[^"]*\b(bg-white|text-white|text-slate-|text-gray-)/.test(U));
  check('17: the writer is told a second person must approve; the two switches are in Settings', U.indexOf('You wrote this one — a second person has to approve it.') > 0 && BP.indexOf("key: 'journals.prepare'") > 0 && BP.indexOf("key: 'journals.approve'") > 0 && R('src/components/SettingsTab.jsx').indexOf("key: 'journals.approve'") > 0);
  check('18: the ledger scenario file is in the repo', fs.existsSync(path.join(root, 'clickbooks/tests/qz2-ledger-drift/16_sl.sql')));
  // caught by the dark-skin screenshot: typed text in a field was light grey on white — every field must carry nt-light
  (function () { var bad = []; ['src/components/MonthEndTab.jsx', 'src/components/JournalEntriesTab.jsx', 'src/components/PayablesPanel.jsx'].forEach(function (f) { (R(f).match(/<(?:input|select)\b[^>]*?className="[^"]*"/g) || []).forEach(function (t) { if (t.indexOf('nt-light') < 0) { bad.push(f + ': ' + t.substring(0, 60)); } }); });
    check('dark skin: every input / select on the new accounting screens uses nt-light (readable typed text)', bad.length === 0, bad); })();
  console.log('\n' + pass + ' passed, ' + failN + ' failed'); if (failN) { process.exit(1); }
})().catch(function (e) { console.error(e); process.exit(1); });
