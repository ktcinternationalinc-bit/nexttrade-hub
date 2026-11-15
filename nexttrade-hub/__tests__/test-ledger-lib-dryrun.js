// Dry-run test for open-account-ledger.js — validates FIFO + 4-pot model.
var fs = require('fs');
var src = fs.readFileSync('/home/claude/work/v55.83/src/lib/open-account-ledger.js', 'utf8');
src = src.replace(/'use client';?/, '').replace(/^export /gm, '');
var lib = (new Function(src + '\nreturn { simulate, computeBalances, computePaidRemaining, findOffsetCandidate, validateOffsetable, buildOffsetEntries };'))();

var fails = 0;
function assert(name, cond) {
  if (cond) { console.log('✓ ' + name); }
  else { console.log('✗ ' + name); fails++; }
}

// ─── SCENARIO 1: Max's exact USD walkthrough ───
console.log('\n══════ SCENARIO 1: Max\'s USD walkthrough ══════');
var s1 = [
  { id: 'e1', entry_date: '2026-05-23', transaction_type: 'payment_received', credit_amount: 1000, currency: 'USD' },
  { id: 'e2', entry_date: '2026-05-23', created_at: '2026-05-23T10:00:00', transaction_type: 'vendor_bill', debit_amount: 28000, currency: 'USD', reference_number: 'VB-001' },
  { id: 'e3', entry_date: '2026-05-23', created_at: '2026-05-23T11:00:00', transaction_type: 'payment_sent', debit_amount: 25000, currency: 'USD' },
  { id: 'e4', entry_date: '2026-05-23', created_at: '2026-05-23T12:00:00', transaction_type: 'payment_sent', debit_amount: 3433, currency: 'USD' },
  { id: 'e8', entry_date: '2026-05-25', transaction_type: 'payment_sent', debit_amount: 23500, currency: 'USD' },
  { id: 'e9', entry_date: '2026-05-25', created_at: '2026-05-25T10:00:00', transaction_type: 'sales_invoice', credit_amount: 20000, currency: 'USD', reference_number: 'INV-001' },
];
var r1 = lib.simulate(s1);
var usd = r1.byCurrency.USD;
console.log('USD pots: theirOpenInvoices=' + usd.theirOpenInvoices + ', ourOpenBills=' + usd.ourOpenBills + ', theirPrepaid=' + usd.theirPrepaid + ', ourPrepaid=' + usd.ourPrepaid + ', net=' + usd.netBalance);

// Walk through expected math:
// e1: they paid $1000 → theirPrepaid = 1000
// e2: vendor bill $28000 → consume theirPrepaid? No, that's the wrong direction. Vendor bill consumes ourPrepaid (0). Bill remaining $28000.
//     Wait — theirPrepaid is THEIR money sitting with us. ourPrepaid is OUR money sitting with them. A vendor bill from them means we owe them, so it consumes OUR prepaid pot (money we've already paid them).
//     ourPrepaid = 0, so bill stays at $28000. ourOpenBills = $28000.
// e3: we paid $25000 → applies to oldest open bill (the $28k) → bill remaining = $3000. ourOpenBills = $3000.
// e4: we paid $3433 → applies $3000 to bill (settled). $433 excess → ourPrepaid = $433.
// e8: we paid $23500 → no open bills → all to ourPrepaid = $433 + $23500 = $23933.
// e9: sales invoice $20000 → consume theirPrepaid first (= $1000) → applied $1000 to invoice → invoice remaining $19000. theirOpenInvoices = $19000.
//     theirPrepaid = $0.

assert('USD theirOpenInvoices = 19000', Math.abs(usd.theirOpenInvoices - 19000) < 0.01);
assert('USD ourOpenBills = 0', Math.abs(usd.ourOpenBills - 0) < 0.01);
assert('USD theirPrepaid = 0', Math.abs(usd.theirPrepaid - 0) < 0.01);
assert('USD ourPrepaid = 23933', Math.abs(usd.ourPrepaid - 23933) < 0.01);
// Net = theirSide - ourSide = (theirOpenInvoices - theirPrepaid) - (ourOpenBills - ourPrepaid)
//     = (19000 - 0) - (0 - 23933) = 19000 + 23933 = 42933 (in our favor)
assert('USD net = +42933 (in our favor)', Math.abs(usd.netBalance - 42933) < 0.01);

// Per-entry applied amounts
assert('VB-001 paid = 28000 (fully)', Math.abs((r1.applications['e2'] || 0) - 28000) < 0.01);
assert('INV-001 paid = 1000 (via prepaid)', Math.abs((r1.applications['e9'] || 0) - 1000) < 0.01);

// ─── SCENARIO 2: invoice consumes prepaid ───
console.log('\n══════ SCENARIO 2: invoice eats prepaid ══════');
var s2 = [
  { id: 'a', entry_date: '2026-01-01', transaction_type: 'payment_received', credit_amount: 5000, currency: 'USD' },
  { id: 'b', entry_date: '2026-01-15', transaction_type: 'sales_invoice', credit_amount: 3000, currency: 'USD' },
];
var r2 = lib.simulate(s2);
var u2 = r2.byCurrency.USD;
console.log('After: theirPrepaid=' + u2.theirPrepaid + ', theirOpenInvoices=' + u2.theirOpenInvoices);
assert('Scen2: theirPrepaid = 2000 (5000 - 3000 consumed)', Math.abs(u2.theirPrepaid - 2000) < 0.01);
assert('Scen2: theirOpenInvoices = 0 (invoice fully covered)', Math.abs(u2.theirOpenInvoices - 0) < 0.01);
assert('Scen2: net = 2000 - 0 = -2000 (we owe them goods)', Math.abs(u2.netBalance - (-2000)) < 0.01);

// ─── SCENARIO 3: payment spills across multiple invoices ───
console.log('\n══════ SCENARIO 3: payment spills FIFO ══════');
var s3 = [
  { id: 'i1', entry_date: '2026-01-01', transaction_type: 'sales_invoice', credit_amount: 2000, currency: 'USD' },
  { id: 'i2', entry_date: '2026-01-05', transaction_type: 'sales_invoice', credit_amount: 1000, currency: 'USD' },
  { id: 'i3', entry_date: '2026-01-10', transaction_type: 'sales_invoice', credit_amount: 4000, currency: 'USD' },
  { id: 'p1', entry_date: '2026-01-20', transaction_type: 'payment_received', credit_amount: 5000, currency: 'USD' },
];
var r3 = lib.simulate(s3);
assert('Scen3: i1 fully paid', Math.abs(r3.applications['i1'] - 2000) < 0.01);
assert('Scen3: i2 fully paid', Math.abs(r3.applications['i2'] - 1000) < 0.01);
assert('Scen3: i3 partial paid = 2000', Math.abs(r3.applications['i3'] - 2000) < 0.01);
assert('Scen3: theirOpenInvoices = 2000', Math.abs(r3.byCurrency.USD.theirOpenInvoices - 2000) < 0.01);
assert('Scen3: theirPrepaid = 0', Math.abs(r3.byCurrency.USD.theirPrepaid - 0) < 0.01);

// ─── SCENARIO 4: overpayment goes to prepaid ───
console.log('\n══════ SCENARIO 4: overpayment ══════');
var s4 = [
  { id: 'i', entry_date: '2026-01-01', transaction_type: 'sales_invoice', credit_amount: 1000, currency: 'USD' },
  { id: 'p', entry_date: '2026-01-05', transaction_type: 'payment_received', credit_amount: 3000, currency: 'USD' },
];
var r4 = lib.simulate(s4);
assert('Scen4: i paid 1000 fully', Math.abs(r4.applications['i'] - 1000) < 0.01);
assert('Scen4: theirPrepaid = 2000', Math.abs(r4.byCurrency.USD.theirPrepaid - 2000) < 0.01);

// ─── SCENARIO 5: EGP works same way independently ───
console.log('\n══════ SCENARIO 5: EGP independent ══════');
var s5 = [
  { id: 'eg1', entry_date: '2026-05-23', transaction_type: 'payment_received', credit_amount: 50000, currency: 'EGP' },
  { id: 'eg2', entry_date: '2026-05-23', transaction_type: 'sales_invoice', credit_amount: 33, currency: 'EGP' },
  { id: 'eg3', entry_date: '2026-05-25', transaction_type: 'payment_received', credit_amount: 50000, currency: 'EGP' },
];
var r5 = lib.simulate(s5);
var egp = r5.byCurrency.EGP;
assert('Scen5 EGP: theirPrepaid = 99967 (50000+50000-33 consumed)', Math.abs(egp.theirPrepaid - 99967) < 0.01);
assert('Scen5 EGP: theirOpenInvoices = 0', Math.abs(egp.theirOpenInvoices - 0) < 0.01);
assert('Scen5 EGP: net = -99967 (they prepaid, we owe goods)', Math.abs(egp.netBalance - (-99967)) < 0.01);

// ─── SCENARIO 6: offset auto-pick ───
console.log('\n══════ SCENARIO 6: offset candidate found ══════');
var s6 = [
  { id: 'i', entry_date: '2026-01-01', transaction_type: 'sales_invoice', credit_amount: 10000, currency: 'USD', reference_number: 'INV-X' },
  { id: 'b', entry_date: '2026-01-05', transaction_type: 'vendor_bill', debit_amount: 3000, currency: 'USD', reference_number: 'VB-Y' },
];
var cand = lib.findOffsetCandidate(s6);
assert('Scen6: candidate found', cand !== null);
assert('Scen6: currency USD', cand && cand.currency === 'USD');
assert('Scen6: offsetAmount = 3000 (min of 10000 and 3000)', cand && Math.abs(cand.offsetAmount - 3000) < 0.01);

// ─── SCENARIO 7: no offset candidate ───
console.log('\n══════ SCENARIO 7: no offset (only invoices in one direction) ══════');
var s7 = [
  { id: 'i1', entry_date: '2026-01-01', transaction_type: 'sales_invoice', credit_amount: 10000, currency: 'USD' },
  { id: 'i2', entry_date: '2026-01-05', transaction_type: 'sales_invoice', credit_amount: 5000, currency: 'USD' },
];
var cand7 = lib.findOffsetCandidate(s7);
assert('Scen7: no candidate', cand7 === null);
assert('Scen7: validateOffsetable empty', lib.validateOffsetable(s7).length === 0);

console.log('\n──────────────────────────────────────────────');
console.log(fails === 0 ? '✅ ALL ' + 21 + ' assertions passed' : '❌ ' + fails + ' assertions failed');
console.log('──────────────────────────────────────────────');
process.exit(fails > 0 ? 1 : 0);
