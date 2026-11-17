// ════════════════════════════════════════════════════════════════════════════
// v55.83-TR — Max, Nov 17: "anytime we update a category, for the same description or key words of the description, it
// automatically ... creates a rule and updates the category". Runs the REAL All Transactions save (expense-rules bulk_classify) on
// an in-memory database: a rule is learned from the key words, and look-alikes are updated RIGHT AWAY — blanks and rule-set ones —
// while a person's hand-picked or verified category is left alone. Money in learns too; "transfer" is never spread.
// ════════════════════════════════════════════════════════════════════════════
var path = require('path'); var Module = require('module'); var fs = require('fs');
var root = path.join(__dirname, '..');
process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'x';
require(path.join(root, 'node_modules/sucrase/register'));
var MemDB = require('./helpers/memdb-wires.js');
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra).substring(0, 700))); }
var mockPath = path.join(__dirname, 'helpers', 'mock-supabase-js.js');
fs.writeFileSync(mockPath, 'module.exports={createClient:function(){return global.__db;}};');
var orig = Module._resolveFilename;
Module._resolveFilename = function (req) { if (req === '@supabase/supabase-js') { return mockPath; } return orig.apply(this, arguments); };
var US = require(path.join(root, 'src/lib/business-of.js')).US_WAVE_BUSINESS_ID;
function tx(id, name, dir, cls, src, verified) { return { id: id, name: name, merchant_name: null, direction: dir || 'out', classification: cls || null, category_source: src || null, category_verified: !!verified, review_status: 'new', wave_business_id: US, transfer_group_id: null, date: '2026-11-0' + (id.length % 9 + 1), amount_abs: 10 }; }
function freshDb() {
  return new MemDB({
    users: [{ id: 'u1', role: 'super_admin', name: 'Max' }], module_permissions: [],
    expense_categories: [{ key: 'utilities', label: 'Utilities' }, { key: 'rent', label: 'Rent' }, { key: 'sales', label: 'Sales' }, { key: 'transfer', label: 'Transfer' }],
    us_expense_rules: [], hub_audit_log: [],
    bank_transactions: [
      tx('t1', 'PUBLIC SERVICE ELEC 0001234 NOV'),          // the one Max categorizes
      tx('t2', 'PUBLIC SERVICE ELEC 0009876 DEC'),          // blank look-alike → updated
      tx('t3', 'Public Service Elec*Pymt', 'out', 'rent', 'rule'),        // set by an old RULE → updated
      tx('t4', 'PUBLIC SERVICE ELEC 5555', 'out', 'rent', 'classification'), // set BY A PERSON → left alone
      tx('t5', 'PUBLIC SERVICE ELEC 7777', 'out', 'rent', 'rule', true),     // VERIFIED → left alone
      tx('t6', 'AMAZON MKTPL 12345'),                       // not a look-alike → untouched
      tx('t7', 'DEPOSIT FROM ACME TRADING INV 991', 'in'),  // money in: Max categorizes it
      tx('t8', 'DEPOSIT FROM ACME TRADING INV 992', 'in')   // its look-alike
    ]
  });
}
global.__db = freshDb();
var route = require(path.join(root, 'src/app/api/accounting/expense-rules/route.js'));
async function call(body) { var res = await route.POST({ json: function () { return Promise.resolve(Object.assign({ user_id: 'u1' }, body)); }, headers: { get: function () { return null; } } }); var j = await res.json(); j._status = res.status; return j; }
function row(id) { return global.__db.t.bank_transactions.filter(function (t) { return t.id === id; })[0]; }

(async function () {
  console.log('TR — categorize one, look-alikes follow');
  var r1 = await call({ action: 'bulk_classify', payload: { ids: ['t1'], classification: 'utilities', single_pick: true } });
  check('the save works and a rule is learned from the key words', r1.ok === true && r1.rules_learned === 1 && global.__db.t.us_expense_rules.length === 1, r1);
  check('blank look-alike (same key words, different reference number) → updated right away', row('t2').classification === 'utilities', row('t2'));
  check('look-alike whose category came from an older RULE → updated', row('t3').classification === 'utilities', row('t3'));
  check('look-alike a PERSON categorized → left as it is', row('t4').classification === 'rent', row('t4'));
  check('VERIFIED look-alike → left as it is', row('t5').classification === 'rent', row('t5'));
  check('a different payee is not touched', row('t6').classification === null, row('t6'));
  check('the answer says how many were updated and how many were left for a person', r1.look_alikes_updated === 2 && r1.look_alikes_left_people >= 1, r1);
  var r2 = await call({ action: 'bulk_classify', payload: { ids: ['t7'], classification: 'sales', single_pick: true } });
  check('money IN learns a rule too, and its look-alike follows', r2.ok === true && row('t8').classification === 'sales', { r2: r2, t8: row('t8') });
  global.__db = freshDb();
  var r3 = await call({ action: 'bulk_classify', payload: { ids: ['t1'], classification: 'transfer', single_pick: true } });
  check('"transfer" is never spread to look-alikes (its other side must be paired by a person)', r3.ok === true && row('t2').classification === null && !r3.look_alikes_updated, { r3: r3, t2: row('t2') });
  var src = fs.readFileSync(path.join(root, 'src/app/api/accounting/bank-write/route.js'), 'utf8');
  check('Bank Review / Categories screens (bank-write classify) apply the rule the same way', /lookAlikes = await applyLookAlikes\(db, ruleId, cPatch\.classification, by\)/.test(src) && /cPatch\.classification !== 'transfer'/.test(src) && /direction === 'in'/.test(src));
  // ── Codex QA 17 Nov: protected lines, auto_apply off, Wave mapping ──
  global.__db = freshDb();
  var T = global.__db.t.bank_transactions;
  T.push(Object.assign(tx('p1', 'PUBLIC SERVICE ELEC 1111'), { account_id: 'acc-priv' }),        // in a PRIVATE account
         Object.assign(tx('p2', 'PUBLIC SERVICE ELEC 2222'), { transfer_group_id: 'g1' }),       // one side of a paired transfer
         Object.assign(tx('p3', 'PUBLIC SERVICE ELEC 3333'), { pending: true }),                  // pending
         Object.assign(tx('p4', 'PUBLIC SERVICE ELEC 4444'), { review_status: 'duplicate' }));    // duplicate copy
  global.__db.t.plaid_accounts = [{ plaid_account_id: 'acc-priv', is_private: true }, { plaid_account_id: 'acc-open', is_private: false }];
  global.__db.t.expense_categories[0].wave_account_id = 'WAVE-UTIL'; global.__db.t.expense_categories[0].wave_account_name = 'Utilities';
  var r4 = await call({ action: 'bulk_classify', payload: { ids: ['t1'], classification: 'utilities', single_pick: true } });
  check('Codex: a look-alike in a PRIVATE account is not touched', row('p1').classification === null, row('p1'));
  check('Codex: one side of a paired transfer is not touched', row('p2').classification === null, row('p2'));
  check('pending and duplicate look-alikes are not touched', row('p3').classification === null && row('p4').classification === null);
  check('the ordinary blank look-alike still follows', row('t2').classification === 'utilities', row('t2'));
  check('Codex: look-alikes it updated also get the category\'s Wave account (like the picked line)', row('t2').wave_account_id === 'WAVE-UTIL' && row('t2').category_status === 'pending_wave_sync' && !row('p1').wave_account_id, row('t2'));
  // a rule switched to "do not apply automatically" is not spread
  global.__db = freshDb();
  global.__db.t.us_expense_rules.push({ id: 'r-off', match_text: 'public service elec', classification: 'utilities', auto_apply: false, active: true, source: 'manual', hit_count: 0 });
  var r5 = await call({ action: 'bulk_classify', payload: { ids: ['t1'], classification: 'utilities', single_pick: true } });
  check('Codex: a rule set to NOT apply automatically is not spread to look-alikes (the picked line still saves)', r5.ok === true && row('t1').classification === 'utilities' && row('t2').classification === null, { r5: r5, t2: row('t2') });
  // Codex recheck P1 — privacy cannot be established → ZERO look-alike changes (thrown error AND returned error)
  var modes = ['throw', 'error', 'missing_column'];
  for (var mi = 0; mi < modes.length; mi++) {
    global.__db = freshDb();
    global.__db.t.bank_transactions.push(Object.assign(tx('p1', 'PUBLIC SERVICE ELEC 1111'), { account_id: 'acc-priv' }));
    global.__db.t.plaid_accounts = [{ plaid_account_id: 'acc-priv', is_private: true }];
    (function (mode, dbx) {
      var realFrom = dbx.from.bind(dbx);
      dbx.from = function (tbl) {
        if (tbl !== 'plaid_accounts') { return realFrom(tbl); }
        if (mode === 'throw') { throw new Error('network down'); }
        var fake = { select: function () { return fake; }, eq: function () { return fake; }, then: function (res) { return Promise.resolve({ data: null, error: { message: mode === 'error' ? 'read failed' : 'column plaid_accounts.is_private does not exist' } }).then(res); } };
        return fake;
      };
    })(modes[mi], global.__db);
    var r6 = await call({ action: 'bulk_classify', payload: { ids: ['t1'], classification: 'utilities', single_pick: true } });
    check('Codex recheck: private-account check ' + modes[mi] + ' → the pick saves, NO look-alike changes (private p1 and ordinary t2 untouched), and the answer says why',
      r6.ok === true && row('t1').classification === 'utilities' && row('p1').classification === null && row('t2').classification === null && !r6.look_alikes_updated && /private/.test(r6.look_alikes_error || ''), { r6: r6, p1: row('p1'), t2: row('t2') });
  }
  console.log('\n' + pass + ' passed, ' + failN + ' failed');
  process.exit(failN ? 1 : 0);
})().catch(function (e) { console.error(e); process.exit(1); });
