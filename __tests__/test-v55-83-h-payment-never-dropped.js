// ============================================================
// v55.83-H regression — a real payment must NEVER vanish from the totals
//
// Production bug (El Sayad, June 2 2026):
//   A 500,000 EGP "SAIB BANK DEPOSIT" payment showed in the line-by-line
//   running column but the top/bottom balance cards ignored it — the EGP
//   net stayed at -998,354.50 instead of -498,354.50 (off by exactly the
//   payment), and "Our credit (prepaid)" showed 0.00.
//
//   Root cause: the entry's transaction_type didn't exactly match the
//   engine's hard list (a stray space / legacy "deposit"-style label), so
//   the simulate() switch fell through to the "unknown → ignored" branch
//   and DROPPED the money.
//
//   Fix: (1) normalize type (trim + lowercase) before matching, and
//        (2) the fall-through branch now applies the amount by debit/credit
//            side instead of discarding it — money is always counted.
//
// Pure unit test of the engine. No browser, no Supabase.
// ============================================================

var fs = require('fs');
var path = require('path');

var candidates = [
  path.join(__dirname, '..', 'src', 'lib', 'open-account-ledger.js'),
  '/home/claude/hub/src/lib/open-account-ledger.js',
];
var srcPath = candidates.find(function (p) { try { return fs.existsSync(p); } catch (e) { return false; } });
var src = fs.readFileSync(srcPath, 'utf8');
src = src.replace(/'use client';?/, '').replace(/^export /gm, '');
var lib = (new Function(src + '\nreturn { simulate };'))();

var fails = 0;
function assert(name, cond) {
  if (cond) { console.log('\u2713 ' + name); }
  else { console.log('\u2717 ' + name); fails++; }
}

// ── Helper: net for a currency ───────────────────────────────
function net(r, cur) { return r.byCurrency[cur] ? r.byCurrency[cur].netBalance : 0; }

// ── SCENARIO A: payment typed "deposit" (not in the hard list) ──
// We owe them 998,354.50 across bills; a 500,000 payment we sent should
// drop what we owe to -498,354.50. With the old engine it vanished.
console.log('\n══════ A: oddly-typed payment still counts ══════');
var a = [
  { id: 'b1', entry_date: '2026-05-01', transaction_type: 'vendor_bill', debit_amount: 483654.00, currency: 'EGP', reference_number: 'VB-A' },
  { id: 'b2', entry_date: '2026-05-13', transaction_type: 'vendor_bill', debit_amount: 514700.50, currency: 'EGP', reference_number: 'VB-008' },
  // The problem row: a payment we sent, mislabeled "deposit"
  { id: 'p1', entry_date: '2026-05-10', transaction_type: 'deposit', debit_amount: 500000, currency: 'EGP', reference_number: 'SAIB' },
];
var ra = lib.simulate(a);
assert('EGP net credits the payment (-498,354.50)', Math.abs(net(ra, 'EGP') - (-498354.50)) < 0.01);
assert('payment is not silently dropped (net != -998,354.50)', Math.abs(net(ra, 'EGP') - (-998354.50)) > 0.01);

// ── SCENARIO B: whitespace / casing variants match canonical branches ──
console.log('\n══════ B: " Payment_Sent " normalizes ══════');
var b = [
  { id: 'b3', entry_date: '2026-05-01', transaction_type: 'vendor_bill', debit_amount: 100000, currency: 'EGP' },
  { id: 'p2', entry_date: '2026-05-05', transaction_type: ' Payment_Sent ', debit_amount: 40000, currency: 'EGP' },
];
var rb = lib.simulate(b);
assert('EGP net = -60,000 after $40k payment', Math.abs(net(rb, 'EGP') - (-60000)) < 0.01);

// ── SCENARIO C: line-by-line trail final == balance-card net ──
// Guarantees the running column and the summary cards can never disagree.
console.log('\n══════ C: trail final equals card net ══════');
var rc = lib.simulate(a);
var lastEgpSnap = null;
rc.trail.forEach(function (t) { if (t.currency === 'EGP') lastEgpSnap = t.snapshotAfter; });
var trailNet = (lastEgpSnap.theirOpenInvoices - lastEgpSnap.theirPrepaid) - (lastEgpSnap.ourOpenBills - lastEgpSnap.ourPrepaid);
assert('trail EGP net == card EGP net', Math.abs(trailNet - net(rc, 'EGP')) < 0.01);

// ── SCENARIO D: a received payment with odd type credits correctly too ──
console.log('\n══════ D: oddly-typed receipt ══════');
var d = [
  { id: 'i1', entry_date: '2026-05-01', transaction_type: 'sales_invoice', credit_amount: 200000, currency: 'USD' },
  { id: 'r1', entry_date: '2026-05-04', transaction_type: 'cash_receipt', credit_amount: 75000, currency: 'USD' },
];
var rd = lib.simulate(d);
assert('USD net = +125,000 after $75k receipt', Math.abs(net(rd, 'USD') - 125000) < 0.01);

console.log('\n' + (fails === 0 ? 'ALL PASS' : (fails + ' FAILED')));
process.exit(fails === 0 ? 0 : 1);
