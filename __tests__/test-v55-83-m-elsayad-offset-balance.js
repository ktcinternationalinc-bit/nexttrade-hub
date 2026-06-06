// v55.83-M — balanced offset fix. El Sayad real ledger must net to the same
// number as the running-balance column, and healthy offsets must still fully cancel.
var path = require('path');
(async function () {
  var m = await import('file://' + path.join(__dirname, '..', 'src/lib/open-account-ledger.js'));
  var fails = 0; function ok(n,c){ if(c) console.log('\u2713 '+n); else { console.log('\u2717 '+n); fails++; } }
  function E(o){ return Object.assign({credit_amount:null,debit_amount:null},o); }

  // --- El Sayad real ledger (abridged to the money-moving rows + all offsets) ---
  var sayad = [
    E({id:'pay300',entry_date:'2025-03-14',currency:'EGP',transaction_type:'payment_sent',debit_amount:300000}),
    E({id:'inv1',entry_date:'2025-08-27',currency:'EGP',transaction_type:'sales_invoice',credit_amount:1119502}),
    E({id:'inv2',entry_date:'2025-10-02',currency:'EGP',transaction_type:'sales_invoice',credit_amount:395797.50}),
    E({id:'b4',entry_date:'2025-10-23',currency:'EGP',transaction_type:'vendor_bill',debit_amount:560000}),
    E({id:'b5',entry_date:'2025-11-23',currency:'EGP',transaction_type:'vendor_bill',debit_amount:560000}),
    E({id:'b6',entry_date:'2025-12-01',currency:'EGP',transaction_type:'vendor_bill',debit_amount:560000}),
    E({id:'b7',entry_date:'2026-02-27',currency:'EGP',transaction_type:'vendor_bill',debit_amount:560000}),
    E({id:'b9',entry_date:'2026-04-28',currency:'EGP',transaction_type:'vendor_bill',debit_amount:650000}),
    E({id:'cust',entry_date:'2026-05-10',currency:'EGP',transaction_type:'sales_invoice',credit_amount:726346}),
    E({id:'saib',entry_date:'2026-05-10',currency:'EGP',transaction_type:'payment_sent',debit_amount:500000}),
    E({id:'b8',entry_date:'2026-05-13',currency:'EGP',transaction_type:'vendor_bill',debit_amount:650000}),
    E({id:'o1a',entry_date:'2026-05-28',currency:'EGP',transaction_type:'offset',debit_amount:260000,offset_pair_id:'P1',offset_invoice_id:'inv1',offset_bill_id:'b4'}),
    E({id:'o1b',entry_date:'2026-05-28',currency:'EGP',transaction_type:'offset',credit_amount:260000,offset_pair_id:'P1',offset_invoice_id:'inv1',offset_bill_id:'b4'}),
    E({id:'o2a',entry_date:'2026-05-28',currency:'EGP',transaction_type:'offset',debit_amount:560000,offset_pair_id:'P2',offset_invoice_id:'inv1',offset_bill_id:'b5'}),
    E({id:'o2b',entry_date:'2026-05-28',currency:'EGP',transaction_type:'offset',credit_amount:560000,offset_pair_id:'P2',offset_invoice_id:'inv1',offset_bill_id:'b5'}),
    E({id:'o3a',entry_date:'2026-05-28',currency:'EGP',transaction_type:'offset',debit_amount:299502,offset_pair_id:'P3',offset_invoice_id:'inv1',offset_bill_id:'b7'}),
    E({id:'o3b',entry_date:'2026-05-28',currency:'EGP',transaction_type:'offset',credit_amount:299502,offset_pair_id:'P3',offset_invoice_id:'inv1',offset_bill_id:'b7'}),
    E({id:'o4a',entry_date:'2026-05-28',currency:'EGP',transaction_type:'offset',debit_amount:260498,offset_pair_id:'P4',offset_invoice_id:'inv2',offset_bill_id:'b7'}),
    E({id:'o4b',entry_date:'2026-05-28',currency:'EGP',transaction_type:'offset',credit_amount:260498,offset_pair_id:'P4',offset_invoice_id:'inv2',offset_bill_id:'b7'}),
    E({id:'o5a',entry_date:'2026-05-28',currency:'EGP',transaction_type:'offset',debit_amount:135299.50,offset_pair_id:'P5',offset_invoice_id:'inv2',offset_bill_id:'b8'}),
    E({id:'o5b',entry_date:'2026-05-28',currency:'EGP',transaction_type:'offset',credit_amount:135299.50,offset_pair_id:'P5',offset_invoice_id:'inv2',offset_bill_id:'b8'}),
    E({id:'o7a',entry_date:'2026-05-28',currency:'EGP',transaction_type:'offset',debit_amount:650000,offset_pair_id:'P7',offset_invoice_id:'cust',offset_bill_id:'b9'}),
    E({id:'o7b',entry_date:'2026-05-28',currency:'EGP',transaction_type:'offset',credit_amount:650000,offset_pair_id:'P7',offset_invoice_id:'cust',offset_bill_id:'b9'}),
    E({id:'o8a',entry_date:'2026-05-29',currency:'EGP',transaction_type:'offset',debit_amount:76346,offset_pair_id:'P8',offset_invoice_id:'cust',offset_bill_id:'b6'}),
    E({id:'o8b',entry_date:'2026-05-29',currency:'EGP',transaction_type:'offset',credit_amount:76346,offset_pair_id:'P8',offset_invoice_id:'cust',offset_bill_id:'b6'}),
  ];
  var r = m.simulate(sayad).byCurrency.EGP;
  ok('El Sayad EGP net = -498,354.50 (matches running balance)', Math.abs(r.netBalance - (-498354.50)) < 0.01);
  // conservation: net must equal raw sum credits - debits of non-offset money rows
  ok('net is conservation-correct (sales - bills + payments)', Math.abs(r.netBalance - ((1119502+395797.50+726346) - (560000*4+650000*2) + (300000+500000))) < 0.01);

  // --- healthy offset: both sides fully open when offset runs -> fully cancels ---
  var healthy = [
    E({id:'hs',entry_date:'2026-01-01',currency:'EGP',transaction_type:'sales_invoice',credit_amount:1000}),
    E({id:'hb',entry_date:'2026-01-02',currency:'EGP',transaction_type:'vendor_bill',debit_amount:1000}),
    E({id:'ha',entry_date:'2026-01-03',currency:'EGP',transaction_type:'offset',debit_amount:1000,offset_pair_id:'H',offset_invoice_id:'hs',offset_bill_id:'hb'}),
    E({id:'hbb',entry_date:'2026-01-03',currency:'EGP',transaction_type:'offset',credit_amount:1000,offset_pair_id:'H',offset_invoice_id:'hs',offset_bill_id:'hb'}),
  ];
  var h = m.simulate(healthy).byCurrency.EGP;
  ok('healthy offset fully cancels both sides (net 0)', Math.abs(h.netBalance) < 0.01 && h.theirOpenInvoices < 0.01 && h.ourOpenBills < 0.01);

  // --- partial healthy: sale 1000, bill 600, offset 1000 -> can only cancel 600 ---
  var partial = [
    E({id:'ps',entry_date:'2026-01-01',currency:'EGP',transaction_type:'sales_invoice',credit_amount:1000}),
    E({id:'pb',entry_date:'2026-01-02',currency:'EGP',transaction_type:'vendor_bill',debit_amount:600}),
    E({id:'pa',entry_date:'2026-01-03',currency:'EGP',transaction_type:'offset',debit_amount:1000,offset_pair_id:'Q',offset_invoice_id:'ps',offset_bill_id:'pb'}),
    E({id:'pbb',entry_date:'2026-01-03',currency:'EGP',transaction_type:'offset',credit_amount:1000,offset_pair_id:'Q',offset_invoice_id:'ps',offset_bill_id:'pb'}),
  ];
  var pr = m.simulate(partial).byCurrency.EGP;
  ok('over-sized offset clamps to bill (they owe us 400, net +400)', Math.abs(pr.netBalance - 400) < 0.01 && Math.abs(pr.theirOpenInvoices - 400) < 0.01 && pr.ourOpenBills < 0.01);

  console.log('\n' + (fails===0 ? 'ALL PASS' : (fails + ' FAILED')));
  process.exit(fails===0?0:1);
})();
