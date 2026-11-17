// ════════════════════════════════════════════════════════════════════════════
// v55.83-TQ — add a bank transaction by hand (Max, Nov 17: "super admin or permissioned can add transactions").
// Runs the REAL route on an in-memory database: who may add, the row's shape, once per click, the "looks already there" check,
// private accounts, bad input, and a failed read adding nothing.
// ════════════════════════════════════════════════════════════════════════════
var path = require('path'); var Module = require('module'); var fs = require('fs');
var root = path.join(__dirname, '..');
process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'x';
require(path.join(root, 'node_modules/sucrase/register'));
var MemDB = require('./helpers/memdb-wires.js');
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra).substring(0, 500))); }
var mockPath = path.join(__dirname, 'helpers', 'mock-supabase-js.js');
fs.writeFileSync(mockPath, 'module.exports={createClient:function(){return global.__db;}};');
var twinCalls = 0; global.__twin = function () { twinCalls++; return Promise.resolve({ removed: 0 }); };
var twinStub = path.join(__dirname, 'helpers', 'stub-duplicates-server.js');
fs.writeFileSync(twinStub, 'module.exports={autoTwinCheck:function(){return global.__twin();}};');
var orig = Module._resolveFilename;
Module._resolveFilename = function (req) {
  if (req === '@supabase/supabase-js') { return mockPath; }
  if (/lib[\\/]verified-caller(\.js)?$/.test(req)) { return path.join(__dirname, 'helpers', 'stub-verified-caller.js'); }
  if (/lib[\\/]duplicates-server(\.js)?$/.test(req)) { return twinStub; }
  return orig.apply(this, arguments);
};
function freshDb() {
  return new MemDB({
    users: [{ id: 'sup', role: 'super_admin', name: 'Max' }, { id: 'adm', role: 'admin', name: 'Admin' }, { id: 'stf', role: 'team', name: 'Staff' }],
    module_permissions: [{ user_id: 'stf', module_name: 'bank.add_transactions', has_access: true }],
    plaid_accounts: [{ plaid_account_id: 'acc-1', name: 'Operating', mask: '1234', wave_business_id: 'US', connection_id: 'c1', is_private: false },
      { plaid_account_id: 'acc-p', name: 'Owner', mask: '9999', wave_business_id: 'US', connection_id: 'c1', is_private: true },
      { plaid_account_id: 'acc-x', name: 'Unassigned', mask: '0000', wave_business_id: null, connection_id: 'c2', is_private: false }],
    bank_connections: [{ id: 'c1', institution_name: 'Chase', wave_business_id: 'US', business_id: 'b1' }, { id: 'c2', institution_name: 'New bank', wave_business_id: null, business_id: null }],
    bank_transactions: [{ id: 't-old', account_id: 'acc-1', date: '2026-11-10', amount_abs: 250, direction: 'out', name: 'PSEG', review_status: 'new', plaid_transaction_id: 'plaid-1' }],
    hub_audit_log: []
  });
}
global.__db = freshDb();
var route = require(path.join(root, 'src/app/api/accounting/manual-transaction/route.js'));
async function call(user, body) { var res = await route.POST({ json: function () { return Promise.resolve(Object.assign({ user_id: user }, body)); }, headers: { get: function () { return null; } } }); var j = await res.json(); j._status = res.status; return j; }
function rows() { return global.__db.t.bank_transactions; }
var base = { action: 'add', plaid_account_id: 'acc-1', date: '2026-11-15', direction: 'out', amount: '1,200.50', description: 'Office rent November', request_id: 'click-000001' };

(async function () {
  console.log('TQ — add a transaction by hand');
  var r0 = await call('adm', base);
  check('an ADMIN without the switch cannot add (role never grants it)', r0._status === 403 && rows().length === 1, r0);
  var rS = await call('sup', base);
  var added = rows().filter(function (t) { return t.id === rS.id; })[0];
  check('the super admin adds one', rS.ok === true && rows().length === 2, rS);
  check('…shaped like a bank line: account, company, date, OUT, amount and Plaid-style sign, “entered by hand”', added && added.account_id === 'acc-1' && added.wave_business_id === 'US' && added.date === '2026-11-15' && added.direction === 'out' && added.amount_abs === 1200.5 && added.amount === 1200.5 && /^\[HAND\] entered by Max/.test(added.bank_source) && added.channel === 'manual_entry' && /^manual-hand-/.test(added.plaid_transaction_id), added);
  check('…and is in the audit trail', global.__db.t.hub_audit_log.some(function (a) { return a.action === 'bank_transaction_added_by_hand'; }));
  var rS2 = await call('sup', base);
  check('the SAME click again (lost answer) → "already added", still one line', rS2.ok === true && rS2.already_added === true && rows().length === 2, rS2);
  var rG = await call('stf', Object.assign({}, base, { request_id: 'click-000002', amount: '75', description: 'Petty cash deposit', direction: 'in' }));
  check('a staff member the super admin switched on can add (money IN stored with a minus, Plaid style)', rG.ok === true && rows().filter(function (t) { return t.id === rG.id; })[0].amount === -75, rG);

  var rD = await call('sup', Object.assign({}, base, { request_id: 'click-000003', date: '2026-11-10', amount: '250', description: 'PSEG electricity' }));
  check('same account + date + amount + direction already there → asks first (409, nothing added)', rD._status === 409 && rD.possible_duplicates && rows().length === 3, rD);
  var twinBefore = twinCalls;
  var rD2 = await call('sup', Object.assign({}, base, { request_id: 'click-000003', date: '2026-11-10', amount: '250', description: 'PSEG electricity', confirm_duplicate: true }));
  check('"yes, it is a different transaction" → added, and the automatic duplicate check is NOT run on it', rD2.ok === true && rows().length === 4 && twinCalls === twinBefore, rD2);

  var rP = await call('stf', Object.assign({}, base, { request_id: 'click-000004', plaid_account_id: 'acc-p' }));
  check('a PRIVATE account: someone who cannot see it cannot add to it', rP._status === 403 && rows().length === 4, rP);
  var rPs = await call('sup', Object.assign({}, base, { request_id: 'click-000005', plaid_account_id: 'acc-p' }));
  check('…the super admin can', rPs.ok === true, rPs);
  var acS = await call('stf', { action: 'accounts' });
  check('the account list hides private accounts from staff and accounts not yet in a company', acS.ok && acS.accounts.map(function (a) { return a.plaid_account_id; }).join() === 'acc-1', acS.accounts);

  var bads = await Promise.all([
    call('sup', Object.assign({}, base, { request_id: 'click-b1', date: '2026-13-40' })),
    call('sup', Object.assign({}, base, { request_id: 'click-b2', amount: '0' })),
    call('sup', Object.assign({}, base, { request_id: 'click-b3', description: '  ' })),
    call('sup', Object.assign({}, base, { request_id: 'click-b4', direction: 'sideways' })),
    call('sup', Object.assign({}, base, { request_id: 'click-b5', plaid_account_id: 'acc-x' }))]);
  check('bad date, zero amount, empty description, no direction, account with no company → each refused, nothing added', bads.every(function (b) { return b.ok === false; }) && rows().length === 5, bads.map(function (b) { return b.error; }));

  global.__db = freshDb(); var realFrom = global.__db.from.bind(global.__db);
  global.__db.from = function (t) { if (t === 'bank_transactions') { var q = realFrom(t); var origSel = q.select.bind(q); q.select = function () { origSel.apply(null, arguments); return { eq: function () { return this; }, gte: function () { return this; }, lte: function () { return this; }, maybeSingle: function () { return Promise.resolve({ data: null, error: { message: 'simulated failure' } }); }, then: function (res) { return Promise.resolve({ data: null, error: { message: 'simulated failure' } }).then(res); } }; }; return q; } return realFrom(t); };
  var rF = await call('sup', Object.assign({}, base, { request_id: 'click-000009' }));
  check('a failed read → refused (503), nothing added', rF._status === 503 && global.__db.t.bank_transactions.length === 1, rF);

  // ── Codex QA 17 Nov (P2 #1) — the same click with CHANGED details is never "already added" ──
  global.__db = freshDb();
  var c1 = await call('sup', base);
  var c2 = await call('sup', Object.assign({}, base, { direction: 'in', amount: '999.00', description: 'Changed rent' }));
  var saved = rows().filter(function (t) { return t.id === c1.id; })[0];
  check('Codex repro: same request id, changed to IN 999.00 "Changed rent" → 409 changed_after_save, nothing changed, form stays open', c1.ok === true && c2._status === 409 && c2.changed_after_save === true && c2.saved_id === c1.id && saved.direction === 'out' && saved.amount_abs === 1200.5 && rows().length === 2, c2);
  var fields = [{ date: '2026-11-16' }, { amount: '1,200.51' }, { description: 'Office rent Nov' }, { check_number: '1001' }];
  var allRefused = true;
  for (var fi = 0; fi < fields.length; fi++) { var cf = await call('sup', Object.assign({}, base, fields[fi])); if (cf._status !== 409 || !cf.changed_after_save) { allRefused = false; } }
  check('each changed field alone (date, a cent, description, check number) → 409, never "already added"', allRefused && rows().length === 2);
  var c3 = await call('sup', base);
  check('the EXACT same click again → "already added" with the saved id', c3.ok === true && c3.already_added === true && c3.id === c1.id);
  // ── Codex QA 17 Nov (P2 #2) — a clash on save is success ONLY when the matching saved line is found with the same details ──
  function clashDb(lookup) {
    global.__db = freshDb(); var rf = global.__db.from.bind(global.__db); var n = 0;
    global.__db.from = function (t) {
      var q = rf(t);
      if (t !== 'bank_transactions') { return q; }
      var oi = q.insert.bind(q);
      q.insert = function (r) { return { select: function () { return { maybeSingle: function () { return Promise.resolve({ data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "bank_transactions_pkey"' } }); } }; } }; };
      var os = q.select.bind(q);
      q.select = function (cols) {
        if (cols && /check_number/.test(cols)) { n++; if (n >= 2) { return lookup(os, cols); } }
        return os.apply(null, arguments);
      };
      return q;
    };
  }
  function fixed(res) { return function () { var o = { eq: function () { return o; }, maybeSingle: function () { return Promise.resolve(res); } }; return o; }; }
  clashDb(fixed({ data: null, error: null }));
  var k1 = await call('sup', Object.assign({}, base, { request_id: 'click-k1' }));
  check('Codex repro: clash on save, then NO saved line found → refused (never ok with id null)', k1.ok === false && k1._status === 409 && !k1.already_added, k1);
  clashDb(fixed({ data: null, error: { message: 'read timeout' } }));
  var k2 = await call('sup', Object.assign({}, base, { request_id: 'click-k2' }));
  check('clash, then the check fails → refused (503)', k2.ok === false && k2._status === 503, k2);
  clashDb(fixed({ data: { id: 'x9', account_id: 'acc-1', date: '2026-11-15', direction: 'in', amount_abs: 5, name: 'other', check_number: null }, error: null }));
  var k3 = await call('sup', Object.assign({}, base, { request_id: 'click-k3' }));
  check('clash, saved line has DIFFERENT details → 409 changed_after_save', k3._status === 409 && k3.changed_after_save === true, k3);
  clashDb(fixed({ data: { id: 'x10', account_id: 'acc-1', date: '2026-11-15', direction: 'out', amount_abs: 1200.5, name: 'Office rent November', check_number: null }, error: null }));
  var k4 = await call('sup', Object.assign({}, base, { request_id: 'click-k4' }));
  check('clash from the same click saved at the same moment (exact details) → "already added" with that id', k4.ok === true && k4.already_added === true && k4.id === 'x10', k4);
  // ── real calendar dates ──
  global.__db = freshDb();
  var dB = await call('sup', Object.assign({}, base, { request_id: 'click-d1', date: '2026-02-30' }));
  var dL = await call('sup', Object.assign({}, base, { request_id: 'click-d2', date: '2028-02-29' }));
  check('Codex: 2026-02-30 is refused; a real leap day 2028-02-29 is accepted', dB.ok === false && dL.ok === true, { dB: dB, dL: dL });

  var st = fs.readFileSync(path.join(root, 'src/components/SettingsTab.jsx'), 'utf8');
  var sp = fs.readFileSync(path.join(root, 'src/lib/server-permissions.js'), 'utf8');
  check('the switch is super-admin-only everywhere (server list, Settings, SQL guard)', /'bank\.add_transactions': 1/.test(sp) && /'bank\.add_transactions': true/.test(st) && /'bank\.add_transactions'\)/.test(fs.readFileSync(path.join(root, 'sql/v55-83-TQ-add-transactions-permission.sql'), 'utf8')));

  console.log('\n' + pass + ' passed, ' + failN + ' failed');
  process.exit(failN ? 1 : 0);
})().catch(function (e) { console.error(e); process.exit(1); });
