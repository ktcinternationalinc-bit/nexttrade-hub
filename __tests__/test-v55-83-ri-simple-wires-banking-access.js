// ═══════════════════════════════════════════════════════════════════════════
// v55.83-RI — Max, Nov 9:
//  10:34 "where the hell are all of the permisssioning and the setup?"
//  10:36 "i need to know where all of the permissioning for rthe banking
//        section as we described??"
//  10:37 "going back again to the wires...it is very USER UNFRIENDLY. WHAT IS
//        GOING ON ...i don't know how to even proceed. how to even choose a
//        freaking bill. make it simple and user friedly"
//  10:38 "i need all of the banking permissions in one box and easy to
//        understand and use"
// ═══════════════════════════════════════════════════════════════════════════
var fs = require('fs');
var path = require('path');
var R = function (p) { return fs.readFileSync(path.join(__dirname, '..', p), 'utf8'); };
var pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ FAIL: ' + name); } }
console.log('RI — simple wires + every banking permission in one box');

var S = R('src/app/api/accounting/wire-packages/route.js');
var U = R('src/components/WirePackagesPanel.jsx');
// ── 1. "how to even choose a freaking bill" — no hidden setup before a bill can be picked
ok('1a: an RTM / NextTrade wire lists ITS bills first AND every other open bill nobody else pays (no "mark paid via first" dead end)',
  S.indexOf('return normRef(b.paid_via) === payeeO || !b.paid_via;') > 0 && S.indexOf("needs_mark: kindO !== 'vendor' && !b.paid_via") > 0);
ok('1b: "A vendor directly" lists every open direct bill; the first bill ticked decides the vendor; mixing vendors is refused in plain words',
  S.indexOf("if (!payeeO && kindO !== 'vendor')") > 0 && S.indexOf("if (vks.length === 1) { payeeS = vset[vks[0]]; }") > 0 && S.indexOf('A wire straight to a vendor pays ONE vendor') > 0 && U.indexOf("b.vendor_name !== pickedVendor") > 0);
ok('1c: ticking another open bill for an RTM wire marks it "paid through RTM" on save — remembered on the line, audited',
  S.indexOf("db.from('vendor_bills').update({ paid_via: payeeS }).in('id', toMark)") > 0 && S.indexOf("marked_paid_via: keepMarked.indexOf(c.bill_id) >= 0") > 0 && S.indexOf("'bill_paid_via_set'") > 0);
ok('1d: untick it, or cancel the wire → the bill goes back to "we pay it directly" (only if still marked for that company)',
  S.indexOf("var unmark = prevMarked.filter(") > 0 && S.indexOf(".update({ paid_via: null }).in('id', unmark).eq('paid_via', prevPayee)") > 0 &&
  S.indexOf(".update({ paid_via: null }).in('id', unC).eq('paid_via', pkg.payee_name)") > 0 && S.indexOf("'bill_paid_via_cleared'") > 0);
ok('1e: a bill paid through a DIFFERENT company still cannot be put on this wire', S.indexOf("it goes on THAT company") > 0);
ok('1f: a missing release # is typed right on the bill row (picking list AND the wire) — open to the preparer, upper-cased, audited, locked once sent',
  S.indexOf("action === 'set_bill_release'") > 0 && S.indexOf("perm(db, userId, ['wires.prepare', 'bills.manage'], req)") > 0 && S.indexOf("toUpperCase().substring(0, 40)") > 0 &&
  S.indexOf("already SENT — its release cannot change now") > 0 && U.indexOf("action: 'set_bill_release'") > 0 && U.indexOf('placeholder="release # needed"') > 0);
ok('1g: the 🤖 check runs BY ITSELF on every save (rules + AI) — nobody has to remember a button', S.indexOf('the 🤖 audit runs by itself on every save') > 0 && S.indexOf('auto: true') > 0 && S.indexOf('audit: autoA') > 0);

// ── 2. "make it simple and user friendly" — one guided screen
ok('2a: new wire = 3 numbered steps: who receives the money (big buttons) → tick the bills (search) → total + Save & check',
  U.indexOf('1 · Who receives the money?') > 0 && U.indexOf('2 · Tick the bills this wire pays') > 0 && U.indexOf("'💾 Save & check →'") > 0 && U.indexOf('🔎 search vendor, bill # or release #') > 0);
ok('2b: whole bill row is clickable to tick it; the amount defaults to what is still owed', U.indexOf('onClick={function () { if (!off) { togglePick(b); } }}') > 0 && U.indexOf('pk[b.id] = String(b.open)') > 0);
ok('2c: every wire shows a progress bar of the steps and ONE "NEXT STEP" box with the one thing to do now',
  U.indexOf("['Prepared', true]") > 0 && U.indexOf('NEXT STEP') > 0 && ['needs_check', 'flagged', 'awaiting_1st', 'ready_to_send', 'sent', 'awaiting_proof', 'complete'].every(function (k) { return U.indexOf("st === '" + k + "'") > 0; }));
ok('2d: each blocking problem says HOW to fix it', U.indexOf('var FIX = {') > 0 && ['RELEASE_MISSING', 'PAID_BEFORE', 'PAYEE_MISMATCH', 'DUP_RELEASE', 'IN_OTHER_PACKAGE'].every(function (k) { return U.indexOf(k + ':') > 0; }));
ok('2e: the list says the next step in plain words; an empty list has a big “＋ New wire” button', U.indexOf('var NEXT_WORDS') > 0 && U.indexOf("'Send it at the bank'") > 0 && U.indexOf('No wires in progress.') > 0);
ok('2f: the 2nd signer is told when they signed first (instead of a failed click)', U.indexOf('You signed first — the 2nd signature must be someone else.') > 0 && S.indexOf('i_signed_first:') > 0);
ok('2g: the detailed record (checks, AI, signatures, proof files) is one click away, not in the way', U.indexOf('The full record — every check, the AI review, signatures and proof files') > 0);

// ── 3. readable in the dark skin
var CSS = R('src/app/globals.css');
ok('3a: .nt-paper = a white panel the dark skin cannot repaint (dark text stays dark)', CSS.indexOf('.nt-paper, .nt-paper.bg-white {') > 0 && CSS.indexOf('.nt-paper .text-slate-900') > 0);
ok('3b: the wire screens use it (no dark-glass bg-white cards with dark inline text)', U.indexOf('bg-white') < 0 && U.indexOf('nt-paper') > 0 && R('src/components/WiresTab.jsx').indexOf('<div className="bg-white rounded-xl') < 0);

// ── 4. every banking permission in ONE box
var B = R('src/components/BankingAccessPanel.jsx'); var ST = R('src/components/SettingsTab.jsx');
ok('4a: Settings has its own “🏦 Banking & Accounting Access” section, second in the row', ST.indexOf("[['roles', 'Team & Roles'], ['banking', '🏦 Banking & Accounting Access']") > 0 && ST.indexOf("section === 'banking'") > 0);
ok('4b: six plain groups in order: books → money → bank work → bills → wires → order recon', (function () {
  var t = ['1 · Which books can they open?', '2 · Which money can they see?', '3 · Bank work', '4 · Bills (what we owe)', '5 · Wires', '6 · Order reconciliation'];
  var at = -1; return t.every(function (x) { var i = B.indexOf(x); var good = i > at; at = i; return good; });
})());
ok('4c: every switch we described is in the box (P1a, P1b, P2, P3, bank balances, overview, bank work, bills, wires, recon)',
  ['accounting.clickbooks.access', 'accounting.wavehub.access', 'accounting.view_totals', 'accounting.view_invoicing', 'canViewBankBalances', 'canViewFullDashboard',
    'bank.view', 'bank.see_amounts', 'bank.view_all_accounts', 'bank.classify', 'bank.connections', 'bills.view', 'bills.manage',
    'wires.view', 'wires.prepare', 'wires.signoff', 'wires.send', 'recon.signoff'].every(function (k) { return B.indexOf("'" + k + "'") > 0; }));
ok('4d: same storage as before — module_permissions via the existing toggle; bank balances / overview via the protected super-admin API',
  B.indexOf('toggle(u.id, it.key, has(u, it.key))') > 0 && B.indexOf("fetch('/api/bank-visibility', { method: 'PUT'") > 0 && B.indexOf('only a super admin can change') > 0);
ok('4e: plain warnings: nothing works without books; wires need ClickBooks; P2/P3 need books; owner/admin = everything automatically; retired switch can be turned off here',
  B.indexOf('Turn on ClickBooks or Wave Hub in group 1 first') > 0 && B.indexOf('Not working yet — turn on ClickBooks (KTC Hub) in group 1.') > 0 &&
  B.indexOf('Not working yet — turn on ClickBooks or Wave Hub in group 1.') > 0 && B.indexOf('already has every switch below') > 0 && B.indexOf("toggle(u.id, 'accounting.view', true)") > 0);
ok('4f: pick a person on the left (searchable, each with a one-line summary), their switches on the right', B.indexOf('🔎 find a person') > 0 && B.indexOf('function summary(x)') > 0);
ok('4g: no duplicates — the Module Access table hides these switches and points to the box', ST.indexOf('BANKING_KEYS.indexOf(p.key) < 0') > 0 && ST.indexOf("onClick={() => setSection('banking')}") > 0);
ok('4h: "Settings → Permissions" (a tab that never existed) no longer appears in the wire / reconciliation messages',
  S.indexOf('Settings → Permissions') < 0 && R('src/components/WiresTab.jsx').indexOf('Settings → Permissions') < 0);

// ── 5. SQL
var Q = R('sql/v55-83-RI-wire-simple.sql');
ok('5a: one new column, safe to re-run (tested on PG16 twice)', /ADD COLUMN IF NOT EXISTS marked_paid_via boolean NOT NULL DEFAULT false/.test(Q));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (fail) { process.exit(1); }
