// ═══════════════════════════════════════════════════════════════════════════
// v55.83-RS — Max, Nov 9 21:36: "clickbooks should book commission in its own account"
// The ledger SQL was run on PG16 (a copy of the ClickBooks test ledger with RB applied, + RP + RQ + RS, twice):
//   NexPac 14350 paid in full from the bank → Vendor payment 3,870.65 / Commission on purchases 483.83 / bank −4,354.48
//   half of it + a $25 fee on one bank line   → 1,935.32 / 241.92 / Bank fee 25.00 / bank −2,202.24
//   NexPac 14353 paid by NextTrade            → 3,086.01 / 385.75 / Due from NextTrade −3,471.76
//   an entry booked the old way (one line) was reversed by the drift run and re-booked in pieces; a second run posts nothing;
//   a bill without commission (AMB) and payments through RTM are untouched.
// This file pins that SQL and checks the proportional rule against the Hub's own split.
// ═══════════════════════════════════════════════════════════════════════════
var fs = require('fs'); var path = require('path');
var root = path.join(__dirname, '..');
require(path.join(root, 'node_modules/sucrase/register'));
var R = function (p) { return fs.readFileSync(path.join(root, p), 'utf8'); };
var L = require(path.join(root, 'src/lib/bill-lines.js'));
var pass = 0, fail = 0;
function ok(name, cond, extra) { if (cond) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ FAIL: ' + name + '  ' + JSON.stringify(extra || '')); } }
console.log('RS — ClickBooks books the commission in its own account');
var Q = R('sql/v55-83-RS-commission-ledger.sql');
ok('1a: its own account: category "Commission on purchases" (purchase_commission) → its ledger account', Q.indexOf("VALUES ('purchase_commission', 'Commission on purchases', 96)") > 0 && Q.indexOf("return clickbooks_us.category_account(p_book, 'purchase_commission');") > 0);
ok('1b: commission part of a payment = payment × the bill\'s commission ÷ the bill total (never more than the payment)', Q.indexOf('return least(p_cents, round(p_cents * com / tot)::bigint);') > 0 && Q.indexOf("l.line_kind = 'item'") > 0);
ok('1c: a bill paid straight from our bank: the bank line is booked in pieces — cost → the bill\'s category, commission → its own account, anything left (a fee) → the line\'s own category',
  Q.indexOf('or clickbooks_us.pays_commission_bill(p_txn)') > 0 && Q.indexOf('union all -- RS: each bill\'s cost part') > 0 && Q.indexOf('union all -- RS: each bill\'s commission part → the commission account') > 0 && Q.indexOf('union all -- RS: the rest of the bank amount') > 0);
ok('1d: a bill NextTrade paid for us: cost + commission against "Due from NextTrade"', Q.indexOf('select jsonb_build_array(cat::text, n - cm, 0) as x') > 0 && Q.indexOf('union all select jsonb_build_array(cacct::text, cm, 0) where cm > 0') > 0);
ok('1e: payments through RTM Capital (service provider) stay ONE line, as decided; bills without commission are untouched', (Q.match(/coalesce\(vp\.method, ''\) <> 'rtm'/g) || []).length >= 4 && Q.indexOf("coalesce(l.commission_amount, 0) > 0") > 0);
ok('1f: nothing is guessed: no approved commission account / no category → it waits with the reason (shown in the sync result)', Q.indexOf("'the commission account is not approved yet'") > 0 && Q.indexOf("'a bill it pays has no category with a ledger account'") > 0 && Q.indexOf("'part of it pays no bill and it has no category for the rest'") > 0);
ok('1g: it extends the RB functions (everything they did is kept) and is safe to re-run', Q.indexOf("or exists(select 1 from public.bank_transaction_splits s where s.bank_transaction_id = p_txn and coalesce(s.linked_type, '') <> 'invoice')") > 0 &&
  Q.indexOf("if not clickbooks_us.has_piecewise(t.id) then return jsonb_build_object('ok', false, 'why', 'whole-category row (classified path)'); end if;") > 0 &&
  Q.indexOf("if t.direction = 'in' and only_ar then return") > 0 && Q.indexOf('ON CONFLICT (key) DO NOTHING') > 0 && (Q.match(/create or replace function/g) || []).length === 6);
// the SQL proportion and the Hub's split agree on the real bill (14350): full payment → exactly the commission line
var ls = [['PVC', 45.05], ['Seconds', 3159.91], ['Paper', 244.35], ['Pool', 75.24], ['Thirds', 346.10]].map(function (r, i) { return L.shapeLine({ description: 'Cambridge ' + r[0] + ' (LBS)', amount: r[1] }, i); });
ls.push(L.shapeLine({ description: 'Commission 12.5%', amount: 483.83 }, 5));
var sp = L.splitBill(ls, { vendor_match: 'NexPac', rate: 0.125 });
var com = Math.round(sp.lines.reduce(function (a, l) { return a + (l.commission_amount || 0) * 100; }, 0));
function sqlCents(pay) { return Math.min(pay, Math.round(pay * (com / 100) / 4354.48)); }
ok('2a: 14350 paid in full → $483.83 commission; half → $241.92 (same rule as the SQL)', sqlCents(435448) === 48383 && sqlCents(217724) === 24192, { com: com });
var BL = R('src/components/BillLinesPanel.jsx');
ok('3a: the bill screen says where ClickBooks books the commission', BL.indexOf('ClickBooks books the commission in “Commission on purchases”') > 0);
console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (fail) { process.exit(1); }
